begin;

create or replace function public.append_message_with_run(
  p_project_id uuid,
  p_message text,
  p_mode public.agent_mode,
  p_schedule_strategy public.schedule_strategy,
  p_agent_keys text[],
  p_client_request_id text,
  p_request_hash text
)
returns table (message_id uuid, run_id uuid, sequence bigint, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_existing public.idempotency_records%rowtype;
  v_message_id uuid := extensions.gen_random_uuid();
  v_run_id uuid := extensions.gen_random_uuid();
  v_sequence bigint;
  v_invalid_agent_count integer;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if octet_length(p_message) not between 1 and 32768 then
    raise exception using errcode = '22023', message = 'INVALID_MESSAGE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));

  select * into v_project
  from public.projects
  where id = p_project_id and owner_id = v_owner_id and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;

  select * into v_existing
  from public.idempotency_records
  where scope = 'send_message'
    and owner_id = v_owner_id
    and idempotency_key = p_client_request_id
    and expires_at > now();
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
    end if;
    return query select
      (v_existing.response_snapshot ->> 'messageId')::uuid,
      (v_existing.response_snapshot ->> 'runId')::uuid,
      (v_existing.response_snapshot ->> 'sequence')::bigint,
      true;
    return;
  end if;

  if exists (
    select 1 from public.agent_runs
    where project_id = p_project_id
      and status in ('queued', 'planning', 'running', 'waiting_for_user', 'cancelling', 'validating')
  ) then
    raise exception using errcode = '55000', message = 'PROJECT_HAS_ACTIVE_RUN';
  end if;

  if coalesce(array_length(p_agent_keys, 1), 0) > 0 then
    select count(*) into v_invalid_agent_count
    from unnest(p_agent_keys) requested(agent_key)
    where not exists (
      select 1 from public.agent_definitions_projection definition
      where definition.agent_key = requested.agent_key and definition.enabled
    );
    if v_invalid_agent_count > 0 then
      raise exception using errcode = '22023', message = 'UNKNOWN_OR_DISABLED_AGENT';
    end if;
  end if;

  update public.conversations
  set last_sequence = last_sequence + 1
  where id = v_project.primary_conversation_id
  returning last_sequence into v_sequence;

  insert into public.messages (
    id, project_id, conversation_id, owner_id, sequence, role, kind,
    status, content, client_request_id, completed_at
  ) values (
    v_message_id, p_project_id, v_project.primary_conversation_id, v_owner_id,
    v_sequence, 'user', 'text', 'completed', jsonb_build_object('text', p_message),
    p_client_request_id, now()
  );

  insert into public.agent_runs (
    id, project_id, conversation_id, owner_id, trigger_message_id,
    mode, schedule_strategy, status
  ) values (
    v_run_id, p_project_id, v_project.primary_conversation_id, v_owner_id,
    v_message_id, p_mode, p_schedule_strategy, 'queued'
  );

  update public.projects
  set active_run_id = v_run_id, status = 'running', revision = revision + 1
  where id = p_project_id;

  insert into public.project_agent_assignments (
    project_id, agent_key, definition_version, source, assigned_run_id
  )
  select
    p_project_id, requested.agent_key, definition.definition_version,
    case when p_schedule_strategy = 'user_selected'
      then 'user_selected'::public.assignment_source
      else 'automatic'::public.assignment_source
    end,
    v_run_id
  from unnest(coalesce(p_agent_keys, '{}'::text[])) requested(agent_key)
  join lateral (
    select d.definition_version
    from public.agent_definitions_projection d
    where d.agent_key = requested.agent_key and d.enabled
    order by d.definition_version desc limit 1
  ) definition on true
  on conflict (project_id, agent_key, removed_at) do update
    set assigned_run_id = excluded.assigned_run_id,
        source = excluded.source,
        status = 'assigned',
        updated_at = now();

  insert into public.outbox_events (project_id, run_id, sequence, event_type, payload)
  values (
    p_project_id, v_run_id, 1, 'run.queued',
    jsonb_build_object('projectId', p_project_id, 'runId', v_run_id)
  );

  insert into public.idempotency_records (
    scope, owner_id, idempotency_key, request_hash, resource_type,
    resource_id, response_snapshot
  ) values (
    'send_message', v_owner_id, p_client_request_id, p_request_hash,
    'message', v_message_id,
    jsonb_build_object('messageId', v_message_id, 'runId', v_run_id, 'sequence', v_sequence)
  );

  return query select v_message_id, v_run_id, v_sequence, false;
end;
$$;

create or replace function public.request_run_cancel(p_run_id uuid)
returns table (run_id uuid, status public.run_status, already_terminal boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_run public.agent_runs%rowtype;
  v_event_sequence bigint;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select * into v_run from public.agent_runs
  where id = p_run_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RUN_NOT_FOUND';
  end if;

  if v_run.status in ('completed', 'failed', 'cancelled') then
    return query select v_run.id, v_run.status, true;
    return;
  end if;

  update public.agent_runs
  set cancel_requested_at = coalesce(cancel_requested_at, now()),
      status = 'cancelling',
      last_event_sequence = last_event_sequence + 1
  where id = p_run_id
  returning last_event_sequence into v_event_sequence;

  insert into public.outbox_events (project_id, run_id, sequence, event_type, payload)
  values (
    v_run.project_id, v_run.id, v_event_sequence, 'run.cancelling',
    jsonb_build_object('runId', v_run.id)
  ) on conflict on constraint outbox_events_run_id_sequence_key do nothing;

  return query select v_run.id, 'cancelling'::public.run_status, false;
end;
$$;

revoke all on function public.append_message_with_run(
  uuid, text, public.agent_mode, public.schedule_strategy, text[], text, text
) from public;
grant execute on function public.append_message_with_run(
  uuid, text, public.agent_mode, public.schedule_strategy, text[], text, text
) to authenticated;
revoke all on function public.request_run_cancel(uuid) from public;
grant execute on function public.request_run_cancel(uuid) to authenticated;

commit;
