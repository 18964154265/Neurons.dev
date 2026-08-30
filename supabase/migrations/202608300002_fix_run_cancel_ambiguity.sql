begin;

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

create or replace function public.confirm_run_cancelled(p_run_id uuid)
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

  select * into v_run
  from public.agent_runs
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
  set status = 'cancelled', cancel_requested_at = coalesce(cancel_requested_at, now()),
      completed_at = now(), last_event_sequence = last_event_sequence + 1
  where id = p_run_id
  returning last_event_sequence into v_event_sequence;

  update public.messages as message
  set status = 'cancelled', completed_at = now()
  where message.run_id = p_run_id
    and message.status in ('pending', 'streaming');

  insert into public.trace_events (
    project_id, run_id, sequence, event_type, status, summary, detail
  ) values (
    v_run.project_id, v_run.id, v_event_sequence,
    'run.cancelled', 'cancelled', '任务已由用户停止', '{}'::jsonb
  ) on conflict on constraint trace_events_run_id_sequence_key do nothing;

  update public.projects
  set active_run_id = null, status = 'stopped', revision = revision + 1
  where id = v_run.project_id and active_run_id = v_run.id;

  return query select v_run.id, 'cancelled'::public.run_status, false;
end;
$$;

revoke all on function public.request_run_cancel(uuid) from public;
grant execute on function public.request_run_cancel(uuid) to authenticated;
revoke all on function public.confirm_run_cancelled(uuid) from public;
grant execute on function public.confirm_run_cancelled(uuid) to authenticated;

commit;
