begin;

insert into public.project_agent_assignments (
  project_id,
  agent_key,
  definition_version,
  source,
  status,
  assigned_run_id
)
select
  project.id,
  default_agent.agent_key,
  definition.definition_version,
  'system'::public.assignment_source,
  case
    when latest_run.status in ('queued', 'planning', 'running', 'waiting_for_user', 'validating', 'cancelling')
      then 'active'::public.assignment_status
    when latest_run.status = 'failed' then 'failed'::public.assignment_status
    when latest_run.status = 'completed' then 'completed'::public.assignment_status
    else 'idle'::public.assignment_status
  end,
  latest_run.id
from public.projects project
cross join lateral (
  select case
    when project.default_mode = 'engineer' then 'alex'::text
    else 'mike'::text
  end as agent_key
) default_agent
join lateral (
  select agent.definition_version
  from public.agent_definitions_projection agent
  where agent.agent_key = default_agent.agent_key and agent.enabled
  order by agent.definition_version desc
  limit 1
) definition on true
left join lateral (
  select run.id, run.status
  from public.agent_runs run
  where run.project_id = project.id
  order by run.created_at desc
  limit 1
) latest_run on true
where project.archived_at is null
  and not exists (
    select 1
    from public.project_agent_assignments assignment
    where assignment.project_id = project.id
      and assignment.agent_key = default_agent.agent_key
      and assignment.removed_at is null
  );

commit;
