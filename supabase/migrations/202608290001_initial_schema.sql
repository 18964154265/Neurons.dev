begin;

create schema if not exists extensions;
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create type public.project_status as enum ('ready', 'running', 'waiting', 'failed', 'stopped');
create type public.project_result_status as enum ('none', 'available', 'published');
create type public.agent_mode as enum ('engineer', 'team');
create type public.schedule_strategy as enum ('automatic', 'user_selected');
create type public.run_status as enum (
  'queued', 'planning', 'running', 'waiting_for_user', 'cancelling',
  'cancelled', 'validating', 'completed', 'failed'
);
create type public.message_role as enum ('user', 'assistant', 'system_event');
create type public.message_kind as enum (
  'text', 'thought_summary', 'tool_summary', 'status', 'error', 'approval'
);
create type public.message_status as enum ('pending', 'streaming', 'completed', 'failed', 'cancelled');
create type public.assignment_status as enum ('assigned', 'active', 'idle', 'completed', 'failed', 'removed');
create type public.assignment_source as enum ('automatic', 'user_selected', 'system');
create type public.agent_execution_status as enum ('assigned', 'running', 'waiting', 'completed', 'failed', 'cancelled');
create type public.event_status as enum ('started', 'progress', 'completed', 'failed', 'cancelled');
create type public.event_visibility as enum ('user', 'internal');
create type public.tool_status as enum (
  'proposed', 'policy_check', 'awaiting_approval', 'running',
  'completed', 'failed', 'cancelled', 'rejected'
);
create type public.sandbox_status as enum ('creating', 'ready', 'busy', 'hibernating', 'stopped', 'failed');
create type public.version_status as enum ('creating', 'ready', 'failed');
create type public.publication_status as enum ('queued', 'building', 'ready', 'failed', 'cancelled');

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status public.project_status not null default 'ready',
  result_status public.project_result_status not null default 'none',
  default_mode public.agent_mode not null default 'engineer',
  default_schedule_strategy public.schedule_strategy not null default 'automatic',
  primary_conversation_id uuid,
  active_run_id uuid,
  current_version_id uuid,
  latest_successful_version_id uuid,
  revision bigint not null default 1 check (revision > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'primary' check (kind = 'primary'),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind)
);

alter table public.projects
  add constraint projects_primary_conversation_fk
  foreign key (primary_conversation_id) references public.conversations(id) on delete set null;

create table public.agent_definitions_projection (
  agent_key text not null,
  definition_version integer not null check (definition_version > 0),
  display_name text not null,
  description text not null,
  avatar_path text,
  tool_labels jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_labels) = 'array'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agent_key, definition_version)
);

create table public.messages (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid,
  agent_key text,
  sequence bigint not null check (sequence > 0),
  role public.message_role not null,
  kind public.message_kind not null default 'text',
  status public.message_status not null default 'pending',
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  client_request_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, sequence),
  unique (owner_id, client_request_id)
);

create table public.agent_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  trigger_message_id uuid not null references public.messages(id) on delete restrict,
  retry_of_run_id uuid references public.agent_runs(id) on delete set null,
  mode public.agent_mode not null,
  schedule_strategy public.schedule_strategy not null,
  status public.run_status not null default 'queued',
  workflow_run_id text,
  model_config_snapshot jsonb not null default '{}'::jsonb,
  agent_plan_snapshot jsonb not null default '{}'::jsonb,
  last_event_sequence bigint not null default 0 check (last_event_sequence >= 0),
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messages
  add constraint messages_run_fk foreign key (run_id) references public.agent_runs(id) on delete set null;

alter table public.projects
  add constraint projects_active_run_fk foreign key (active_run_id) references public.agent_runs(id) on delete set null;

create unique index projects_one_active_write_run_idx
  on public.agent_runs(project_id)
  where status in ('queued', 'planning', 'running', 'waiting_for_user', 'cancelling', 'validating');

create table public.project_agent_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_key text not null,
  definition_version integer not null,
  source public.assignment_source not null,
  status public.assignment_status not null default 'assigned',
  assigned_run_id uuid references public.agent_runs(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agent_key, definition_version)
    references public.agent_definitions_projection(agent_key, definition_version),
  unique nulls not distinct (project_id, agent_key, removed_at)
);

create table public.run_agent_states (
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  agent_key text not null,
  definition_version integer not null,
  status public.agent_execution_status not null default 'assigned',
  current_step text,
  parent_agent_key text,
  depends_on jsonb not null default '[]'::jsonb check (jsonb_typeof(depends_on) = 'array'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, agent_key),
  foreign key (agent_key, definition_version)
    references public.agent_definitions_projection(agent_key, definition_version)
);

create table public.tool_invocations (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  agent_key text not null,
  tool_key text not null,
  tool_version integer not null check (tool_version > 0),
  effect_key text not null unique,
  status public.tool_status not null default 'proposed',
  input_redacted jsonb not null default '{}'::jsonb,
  output_redacted jsonb not null default '{}'::jsonb,
  approval_status text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trace_events (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  agent_key text,
  sequence bigint not null check (sequence > 0),
  event_type text not null,
  status public.event_status not null,
  visibility public.event_visibility not null default 'user',
  summary text not null default '',
  detail jsonb not null default '{}'::jsonb,
  parent_event_id uuid references public.trace_events(id) on delete set null,
  correlation_id uuid not null default extensions.gen_random_uuid(),
  file_path text,
  terminal_session_id uuid,
  tool_invocation_id uuid references public.tool_invocations(id) on delete set null,
  redaction_version integer not null default 1 check (redaction_version > 0),
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);

create table public.sandbox_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider_sandbox_id text not null unique,
  status public.sandbox_status not null default 'creating',
  base_snapshot_id text,
  current_snapshot_id text,
  preview_port integer check (preview_port is null or preview_port between 1 and 65535),
  preview_url_expires_at timestamptz,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terminal_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  agent_key text,
  command_summary text not null,
  cwd text not null,
  status public.event_status not null default 'started',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trace_events
  add constraint trace_terminal_session_fk
  foreign key (terminal_session_id) references public.terminal_sessions(id) on delete set null;

create table public.terminal_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  terminal_session_id uuid not null references public.terminal_sessions(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  stream text not null check (stream in ('stdout', 'stderr')),
  content text,
  storage_path text,
  byte_length integer not null check (byte_length between 0 and 16384),
  created_at timestamptz not null default now(),
  check ((content is not null) <> (storage_path is not null)),
  unique (terminal_session_id, sequence)
);

create table public.project_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  parent_version_id uuid references public.project_versions(id) on delete set null,
  source_run_id uuid references public.agent_runs(id) on delete set null,
  status public.version_status not null default 'creating',
  snapshot_provider_id text,
  artifact_manifest_path text,
  git_commit_sha text,
  preview_status public.event_status,
  validation_summary jsonb not null default '{}'::jsonb,
  is_successful boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, ordinal)
);

alter table public.projects
  add constraint projects_current_version_fk
  foreign key (current_version_id) references public.project_versions(id) on delete set null,
  add constraint projects_latest_successful_version_fk
  foreign key (latest_successful_version_id) references public.project_versions(id) on delete set null;

create table public.artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid references public.project_versions(id) on delete cascade,
  kind text not null,
  storage_bucket text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table public.publications (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid not null references public.project_versions(id) on delete restrict,
  provider text not null,
  deployment_id text,
  url text,
  status public.publication_status not null default 'queued',
  error_summary text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.idempotency_records (
  id uuid primary key default extensions.gen_random_uuid(),
  scope text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  resource_type text not null,
  resource_id uuid not null,
  response_snapshot jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  unique (scope, owner_id, idempotency_key)
);

create table public.outbox_events (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);

create index projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
create index conversations_project_idx on public.conversations(project_id);
create index messages_project_created_idx on public.messages(project_id, created_at desc);
create index messages_conversation_sequence_idx on public.messages(conversation_id, sequence);
create index agent_runs_project_created_idx on public.agent_runs(project_id, created_at desc);
create index trace_events_project_created_idx on public.trace_events(project_id, created_at desc);
create index project_agent_assignments_active_idx on public.project_agent_assignments(project_id) where removed_at is null;
create index project_versions_project_ordinal_idx on public.project_versions(project_id, ordinal desc);
create index terminal_chunks_session_sequence_idx on public.terminal_chunks(terminal_session_id, sequence);
create index outbox_events_pending_idx on public.outbox_events(next_attempt_at) where published_at is null;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();
create trigger messages_set_updated_at before update on public.messages
  for each row execute function private.set_updated_at();
create trigger agent_runs_set_updated_at before update on public.agent_runs
  for each row execute function private.set_updated_at();
create trigger agent_definitions_set_updated_at before update on public.agent_definitions_projection
  for each row execute function private.set_updated_at();
create trigger project_agent_assignments_set_updated_at before update on public.project_agent_assignments
  for each row execute function private.set_updated_at();
create trigger run_agent_states_set_updated_at before update on public.run_agent_states
  for each row execute function private.set_updated_at();
create trigger tool_invocations_set_updated_at before update on public.tool_invocations
  for each row execute function private.set_updated_at();
create trigger sandbox_sessions_set_updated_at before update on public.sandbox_sessions
  for each row execute function private.set_updated_at();
create trigger terminal_sessions_set_updated_at before update on public.terminal_sessions
  for each row execute function private.set_updated_at();
create trigger project_versions_set_updated_at before update on public.project_versions
  for each row execute function private.set_updated_at();
create trigger publications_set_updated_at before update on public.publications
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects
    where id = p_project_id
      and owner_id = (select auth.uid())
      and archived_at is null
  );
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
revoke all on function private.is_project_owner(uuid) from public;
grant execute on function private.is_project_owner(uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.agent_definitions_projection enable row level security;
alter table public.agent_runs enable row level security;
alter table public.project_agent_assignments enable row level security;
alter table public.run_agent_states enable row level security;
alter table public.tool_invocations enable row level security;
alter table public.trace_events enable row level security;
alter table public.sandbox_sessions enable row level security;
alter table public.terminal_sessions enable row level security;
alter table public.terminal_chunks enable row level security;
alter table public.project_versions enable row level security;
alter table public.artifacts enable row level security;
alter table public.publications enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.outbox_events enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy projects_select_own on public.projects for select to authenticated
  using (owner_id = (select auth.uid()));
create policy projects_insert_own on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy projects_update_own on public.projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy agent_definitions_read_enabled on public.agent_definitions_projection
  for select to authenticated using (enabled);

create policy conversations_owner_all on public.conversations for all to authenticated
  using (private.is_project_owner(project_id)) with check (private.is_project_owner(project_id));
create policy messages_owner_all on public.messages for all to authenticated
  using (private.is_project_owner(project_id)) with check (private.is_project_owner(project_id));
create policy agent_runs_owner_all on public.agent_runs for all to authenticated
  using (private.is_project_owner(project_id)) with check (private.is_project_owner(project_id));
create policy assignments_owner_select on public.project_agent_assignments for select to authenticated
  using (private.is_project_owner(project_id));
create policy run_agent_states_owner_select on public.run_agent_states for select to authenticated
  using (private.is_project_owner(project_id));
create policy tools_owner_select on public.tool_invocations for select to authenticated
  using (private.is_project_owner(project_id));
create policy trace_owner_select on public.trace_events for select to authenticated
  using (private.is_project_owner(project_id) and visibility = 'user');
create policy sandboxes_owner_select on public.sandbox_sessions for select to authenticated
  using (private.is_project_owner(project_id));
create policy terminal_sessions_owner_select on public.terminal_sessions for select to authenticated
  using (private.is_project_owner(project_id));
create policy terminal_chunks_owner_select on public.terminal_chunks for select to authenticated
  using (private.is_project_owner(project_id));
create policy versions_owner_select on public.project_versions for select to authenticated
  using (private.is_project_owner(project_id));
create policy artifacts_owner_select on public.artifacts for select to authenticated
  using (private.is_project_owner(project_id));
create policy publications_owner_select on public.publications for select to authenticated
  using (private.is_project_owner(project_id));
create policy idempotency_owner_select on public.idempotency_records for select to authenticated
  using (owner_id = (select auth.uid()));
create policy idempotency_owner_insert on public.idempotency_records for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy outbox_owner_select on public.outbox_events for select to authenticated
  using (private.is_project_owner(project_id));

create or replace function public.create_project_with_run(
  p_name text,
  p_initial_message text,
  p_mode public.agent_mode,
  p_schedule_strategy public.schedule_strategy,
  p_agent_keys text[],
  p_client_request_id text,
  p_request_hash text
)
returns table (
  project_id uuid,
  conversation_id uuid,
  message_id uuid,
  run_id uuid,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_existing public.idempotency_records%rowtype;
  v_project_id uuid := extensions.gen_random_uuid();
  v_conversation_id uuid := extensions.gen_random_uuid();
  v_message_id uuid := extensions.gen_random_uuid();
  v_run_id uuid := extensions.gen_random_uuid();
  v_invalid_agent_count integer;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if char_length(trim(p_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'INVALID_PROJECT_NAME';
  end if;
  if octet_length(p_initial_message) not between 1 and 32768 then
    raise exception using errcode = '22023', message = 'INVALID_INITIAL_MESSAGE';
  end if;
  if char_length(p_client_request_id) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':project:' || p_client_request_id, 0)
  );

  select * into v_existing
  from public.idempotency_records
  where scope = 'create_project'
    and owner_id = v_owner_id
    and idempotency_key = p_client_request_id
    and expires_at > now();

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
    end if;
    return query select
      (v_existing.response_snapshot ->> 'projectId')::uuid,
      (v_existing.response_snapshot ->> 'conversationId')::uuid,
      (v_existing.response_snapshot ->> 'messageId')::uuid,
      (v_existing.response_snapshot ->> 'runId')::uuid,
      true;
    return;
  end if;

  if coalesce(array_length(p_agent_keys, 1), 0) > 0 then
    select count(*) into v_invalid_agent_count
    from unnest(p_agent_keys) requested(agent_key)
    where not exists (
      select 1
      from public.agent_definitions_projection definition
      where definition.agent_key = requested.agent_key
        and definition.enabled
    );
    if v_invalid_agent_count > 0 then
      raise exception using errcode = '22023', message = 'UNKNOWN_OR_DISABLED_AGENT';
    end if;
  end if;

  insert into public.projects (
    id, owner_id, name, status, default_mode, default_schedule_strategy
  ) values (
    v_project_id, v_owner_id, trim(p_name), 'running', p_mode, p_schedule_strategy
  );

  insert into public.conversations (id, project_id, owner_id, last_sequence)
  values (v_conversation_id, v_project_id, v_owner_id, 1);

  update public.projects
  set primary_conversation_id = v_conversation_id
  where id = v_project_id;

  insert into public.messages (
    id, project_id, conversation_id, owner_id, sequence, role, kind,
    status, content, client_request_id, completed_at
  ) values (
    v_message_id, v_project_id, v_conversation_id, v_owner_id, 1,
    'user', 'text', 'completed', jsonb_build_object('text', p_initial_message),
    p_client_request_id, now()
  );

  insert into public.agent_runs (
    id, project_id, conversation_id, owner_id, trigger_message_id,
    mode, schedule_strategy, status
  ) values (
    v_run_id, v_project_id, v_conversation_id, v_owner_id, v_message_id,
    p_mode, p_schedule_strategy, 'queued'
  );

  update public.projects set active_run_id = v_run_id where id = v_project_id;

  insert into public.project_agent_assignments (
    project_id, agent_key, definition_version, source, assigned_run_id
  )
  select
    v_project_id,
    requested.agent_key,
    definition.definition_version,
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
    order by d.definition_version desc
    limit 1
  ) definition on true;

  insert into public.outbox_events (
    project_id, run_id, sequence, event_type, payload
  ) values (
    v_project_id, v_run_id, 1, 'run.queued',
    jsonb_build_object('projectId', v_project_id, 'runId', v_run_id)
  );

  insert into public.idempotency_records (
    scope, owner_id, idempotency_key, request_hash, resource_type,
    resource_id, response_snapshot
  ) values (
    'create_project', v_owner_id, p_client_request_id, p_request_hash,
    'project', v_project_id,
    jsonb_build_object(
      'projectId', v_project_id,
      'conversationId', v_conversation_id,
      'messageId', v_message_id,
      'runId', v_run_id
    )
  );

  return query select v_project_id, v_conversation_id, v_message_id, v_run_id, false;
end;
$$;

revoke all on function public.create_project_with_run(
  text, text, public.agent_mode, public.schedule_strategy, text[], text, text
) from public;
grant execute on function public.create_project_with_run(
  text, text, public.agent_mode, public.schedule_strategy, text[], text, text
) to authenticated;

grant select on public.profiles, public.projects, public.conversations, public.messages,
  public.agent_definitions_projection, public.agent_runs, public.project_agent_assignments,
  public.run_agent_states, public.tool_invocations, public.trace_events,
  public.sandbox_sessions, public.terminal_sessions, public.terminal_chunks,
  public.project_versions, public.artifacts, public.publications,
  public.idempotency_records, public.outbox_events to authenticated;
grant update on public.profiles, public.projects to authenticated;
revoke all on all tables in schema public from anon;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'projects', 'messages', 'agent_runs', 'project_agent_assignments',
    'run_agent_states', 'trace_events', 'terminal_sessions', 'terminal_chunks'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-artifacts', 'project-artifacts', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy project_artifacts_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-artifacts'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
create policy project_artifacts_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-artifacts'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
create policy project_artifacts_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-artifacts'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'project-artifacts'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

commit;
