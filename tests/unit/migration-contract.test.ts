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

  it("projects only the five confirmed agent definitions", () => {
    for (const key of ["mike", "emma", "bob", "alex", "david"]) {
      expect(agentDefinitionsMigration).toContain(`'${key}', 1`);
    }
    expect(agentDefinitionsMigration).toContain("where agent_key not in");
    expect(agentDefinitionsMigration).toContain("enabled = false");
  });
});
