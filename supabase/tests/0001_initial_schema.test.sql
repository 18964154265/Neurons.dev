begin;

select plan(24);

select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'conversations', 'conversations table exists');
select has_table('public', 'messages', 'messages table exists');
select has_table('public', 'agent_runs', 'agent_runs table exists');
select has_table('public', 'trace_events', 'trace_events table exists');
select has_table('public', 'tool_invocations', 'tool_invocations table exists');
select has_table('public', 'project_versions', 'project_versions table exists');
select has_table('public', 'outbox_events', 'outbox_events table exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.projects'::regclass),
  true,
  'projects has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  true,
  'messages has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.agent_runs'::regclass),
  true,
  'agent_runs has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.trace_events'::regclass),
  true,
  'trace_events has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.project_versions'::regclass),
  true,
  'project_versions has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.outbox_events'::regclass),
  true,
  'outbox_events has RLS enabled'
);

select has_function(
  'public',
  'create_project_with_run',
  array['text', 'text', 'agent_mode', 'schedule_strategy', 'text[]', 'text', 'text'],
  'atomic project creation function exists'
);
select has_function('private', 'is_project_owner', array['uuid'], 'ownership helper exists');

select has_index('public', 'projects', 'projects_owner_updated_idx', 'dashboard index exists');
select has_index('public', 'messages', 'messages_conversation_sequence_idx', 'message sequence index exists');
select has_index('public', 'agent_runs', 'projects_one_active_write_run_idx', 'single active run index exists');
select has_index('public', 'trace_events', 'trace_events_run_id_sequence_key', 'trace sequence constraint index exists');
select has_index('public', 'outbox_events', 'outbox_events_pending_idx', 'outbox retry index exists');

select policies_are(
  'public',
  'projects',
  array['projects_insert_own', 'projects_select_own', 'projects_update_own'],
  'projects exposes only owner policies'
);
select policies_are(
  'public',
  'trace_events',
  array['trace_owner_select'],
  'trace is read-only and owner-scoped for clients'
);
select policies_are(
  'public',
  'agent_definitions_projection',
  array['agent_definitions_read_enabled'],
  'agent projection is read-only for clients'
);

select * from finish();
rollback;
