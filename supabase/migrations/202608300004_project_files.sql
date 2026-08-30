begin;

create table public.project_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  content text not null default '',
  language text not null default 'plaintext',
  revision integer not null default 1 check (revision > 0),
  checksum text not null,
  source_run_id uuid references public.agent_runs(id) on delete set null,
  source_agent_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, path),
  check (char_length(path) between 1 and 240),
  check (octet_length(content) <= 262144)
);

create index project_files_project_updated_idx
  on public.project_files(project_id, updated_at desc);

create trigger project_files_set_updated_at before update on public.project_files
  for each row execute function private.set_updated_at();

alter table public.project_files enable row level security;

create policy project_files_owner_select on public.project_files
  for select to authenticated
  using (private.is_project_owner(project_id));

grant select on public.project_files to authenticated;
revoke all on public.project_files from anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_files'
  ) then
    alter publication supabase_realtime add table public.project_files;
  end if;
end;
$$;

commit;
