import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608290001_initial_schema.sql"),
  "utf8",
);
const cancelMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608290003_confirm_run_cancel.sql",
  ),
  "utf8",
);
const agentDefinitionsMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608300001_agent_definitions.sql"),
  "utf8",
);
const cancelAmbiguityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608300002_fix_run_cancel_ambiguity.sql",
  ),
  "utf8",
);
const defaultAssignmentsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608300003_backfill_default_agent_assignments.sql",
  ),
  "utf8",
);
const projectFilesMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608300004_project_files.sql"),
  "utf8",
);

describe("initial database migration", () => {
  it.each([
    "projects",
    "conversations",
    "messages",
    "agent_runs",
    "trace_events",
    "tool_invocations",
    "project_versions",
    "outbox_events",
  ])("creates and protects %s", (table) => {
    expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain(
      `alter table public.${table} enable row level security`,
    );
  });

  it("creates the atomic project command and revokes public execution", () => {
    expect(migration).toContain("function public.create_project_with_run");
    expect(migration).toContain(") from public;");
    expect(migration).toContain(") to authenticated;");
  });

  it("never grants business tables to anon", () => {
    expect(migration).toContain(
      "revoke all on all tables in schema public from anon",
    );
    expect(migration).not.toMatch(
      /grant\s+(select|insert|update|delete).*\s+to\s+anon/i,
    );
  });

  it("confirms workflow cancellation atomically", () => {
    expect(cancelMigration).toContain("function public.confirm_run_cancelled");
    expect(cancelMigration).toContain("set status = 'cancelled'");
    expect(cancelMigration).toContain(
      "set active_run_id = null, status = 'stopped'",
    );
    expect(cancelMigration).toContain("to authenticated");
    expect(cancelMigration).toContain(
      "function public.fail_run_workflow_start",
    );
    expect(cancelMigration).toContain("'workflow.start_failed'");
  });

  it("uses named constraints in cancellation functions to avoid PL/pgSQL ambiguity", () => {
    expect(cancelAmbiguityMigration).toContain(
      "on conflict on constraint outbox_events_run_id_sequence_key",
    );
    expect(cancelAmbiguityMigration).toContain(
      "on conflict on constraint trace_events_run_id_sequence_key",
    );
    expect(cancelAmbiguityMigration).not.toContain(
      "on conflict (run_id, sequence)",
    );
    expect(cancelAmbiguityMigration).toContain(
      "where message.run_id = p_run_id",
    );
  });

  it("projects only the five confirmed agent definitions", () => {
    for (const key of ["mike", "emma", "bob", "alex", "david"]) {
      expect(agentDefinitionsMigration).toContain(`'${key}', 1`);
    }
    expect(agentDefinitionsMigration).toContain("where agent_key not in");
    expect(agentDefinitionsMigration).toContain("enabled = false");
  });

  it("backfills a real default assignment for existing projects", () => {
    expect(defaultAssignmentsMigration).toContain(
      "when project.default_mode = 'engineer' then 'alex'",
    );
    expect(defaultAssignmentsMigration).toContain("else 'mike'");
    expect(defaultAssignmentsMigration).toContain(
      "insert into public.project_agent_assignments",
    );
  });

  it("creates an owner-readable realtime project file projection", () => {
    expect(projectFilesMigration).toContain(
      "create table public.project_files",
    );
    expect(projectFilesMigration).toContain(
      "alter table public.project_files enable row level security",
    );
    expect(projectFilesMigration).toContain(
      "private.is_project_owner(project_id)",
    );
    expect(projectFilesMigration).toContain(
      "alter publication supabase_realtime add table public.project_files",
    );
  });
});
