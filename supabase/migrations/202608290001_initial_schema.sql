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
