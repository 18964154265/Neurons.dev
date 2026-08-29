begin;

create or replace function public.fail_run_workflow_start(
  p_run_id uuid,
  p_failure_code text
)
returns void
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
  if v_run.status <> 'queued' then
    return;
  end if;

  update public.agent_runs
  set status = 'failed', failure_code = left(p_failure_code, 120), completed_at = now(),
      last_event_sequence = last_event_sequence + 1
  where id = v_run.id
  returning last_event_sequence into v_event_sequence;

  insert into public.trace_events (
    project_id, run_id, sequence, event_type, status, summary, detail
  ) values (
    v_run.project_id, v_run.id, v_event_sequence,
    'workflow.start_failed', 'failed', '任务执行器启动失败',
    jsonb_build_object('code', left(p_failure_code, 120))
  );

  update public.projects
  set active_run_id = null, status = 'failed', revision = revision + 1
  where id = v_run.project_id and active_run_id = v_run.id;
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

  update public.messages
  set status = 'cancelled', completed_at = now()
  where run_id = p_run_id and status in ('pending', 'streaming');

  insert into public.trace_events (
    project_id, run_id, sequence, event_type, status, summary, detail
  ) values (
    v_run.project_id, v_run.id, v_event_sequence,
    'run.cancelled', 'cancelled', '任务已由用户停止', '{}'::jsonb
  ) on conflict (run_id, sequence) do nothing;

  update public.projects
  set active_run_id = null, status = 'stopped', revision = revision + 1
  where id = v_run.project_id and active_run_id = v_run.id;

  return query select v_run.id, 'cancelled'::public.run_status, false;
end;
$$;

revoke all on function public.confirm_run_cancelled(uuid) from public;
grant execute on function public.confirm_run_cancelled(uuid) to authenticated;
revoke all on function public.fail_run_workflow_start(uuid, text) from public;
grant execute on function public.fail_run_workflow_start(uuid, text) to authenticated;

commit;
