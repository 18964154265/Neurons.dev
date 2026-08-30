import "server-only";

import { createHash } from "node:crypto";

import { ZodError } from "zod";

import { resolveEngineerDefinition } from "@/lib/agents/registry";
import { getDatabase } from "@/lib/db/postgres";
import {
  languageForProjectFile,
  listProjectFilesInputSchema,
  readProjectFileInputSchema,
  writeProjectFileInputSchema,
} from "@/lib/files/project-file";
import type { LLMToolCall } from "@/lib/llm/types";
import type { PreparedEngineerRun } from "@/lib/runs/worker-store";

export type WorkspaceToolResult = {
  toolCallId: string;
  content: string;
  filePath: string | null;
};

function effectKey(runId: string, call: LLMToolCall) {
  return createHash("sha256")
    .update(`${runId}:${call.id}:${call.name}:${call.arguments}`)
    .digest("hex");
}

function parseArguments(call: LLMToolCall) {
  try {
    return JSON.parse(call.arguments || "{}") as unknown;
  } catch {
    throw new Error(`TOOL_ARGUMENTS_INVALID_JSON:${call.name}`);
  }
}

function safeToolError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: "TOOL_ARGUMENTS_INVALID",
      issues: error.issues.map(({ path, message }) => ({ path, message })),
    };
  }
  return {
    ok: false,
    error:
      error instanceof Error
        ? error.message.slice(0, 240)
        : "TOOL_EXECUTION_FAILED",
  };
}

async function executeWorkspaceOperation(
  run: PreparedEngineerRun,
  call: LLMToolCall,
): Promise<{ output: Record<string, unknown>; filePath: string | null }> {
  const sql = getDatabase();
  const input = parseArguments(call);

  if (call.name === "workspace_list_files") {
    listProjectFilesInputSchema.parse(input);
    const files = await sql<
      Array<{ path: string; revision: number; language: string }>
    >`
      select path, revision, language
      from public.project_files
      where project_id = ${run.projectId}::uuid
      order by path
      limit 500
    `;
    return { output: { ok: true, files }, filePath: null };
  }

  if (call.name === "workspace_read_file") {
    const { path } = readProjectFileInputSchema.parse(input);
    const rows = await sql<
      Array<{ content: string; revision: number; checksum: string }>
    >`
      select content, revision, checksum
      from public.project_files
      where project_id = ${run.projectId}::uuid and path = ${path}
    `;
    const file = rows[0];
    return {
      output: file
        ? { ok: true, path, ...file }
        : { ok: false, error: "FILE_NOT_FOUND", path },
      filePath: path,
    };
  }

  if (call.name === "workspace_write_file") {
    const { path, content } = writeProjectFileInputSchema.parse(input);
    const checksum = createHash("sha256").update(content).digest("hex");
    const language = languageForProjectFile(path);
    const rows = await sql<Array<{ revision: number }>>`
      insert into public.project_files (
        project_id, path, content, language, checksum, source_run_id, source_agent_key
      ) values (
        ${run.projectId}::uuid, ${path}, ${content}, ${language}, ${checksum},
        ${run.runId}::uuid, 'alex'
      )
      on conflict (project_id, path) do update
      set content = excluded.content,
          language = excluded.language,
          checksum = excluded.checksum,
          source_run_id = excluded.source_run_id,
          source_agent_key = excluded.source_agent_key,
          revision = public.project_files.revision + 1
      returning revision
    `;
    return {
      output: {
        ok: true,
        path,
        revision: rows[0]?.revision,
        checksum,
        bytes: Buffer.byteLength(content, "utf8"),
      },
      filePath: path,
    };
  }

  throw new Error(`TOOL_NOT_IMPLEMENTED:${call.name}`);
}

export async function executeWorkspaceToolCall(
  run: PreparedEngineerRun,
  call: LLMToolCall,
): Promise<WorkspaceToolResult> {
  const definition = resolveEngineerDefinition();
  if (!definition.tools.some((tool) => tool.name === call.name)) {
    throw new Error(`TOOL_NOT_ALLOWED:${call.name}`);
  }
  if (!call.id) throw new Error(`TOOL_CALL_ID_REQUIRED:${call.name}`);

  const sql = getDatabase();
  const key = effectKey(run.runId, call);
  const startedAt = Date.now();
  let operation: Awaited<ReturnType<typeof executeWorkspaceOperation>>;
  let status: "completed" | "failed" = "completed";

  try {
    operation = await executeWorkspaceOperation(run, call);
  } catch (error) {
    status = "failed";
    operation = { output: safeToolError(error), filePath: null };
  }
  const persistedOutput = JSON.parse(JSON.stringify(operation.output));

  await sql.begin(async (transaction) => {
    const invocationRows = await transaction<Array<{ id: string }>>`
      insert into public.tool_invocations (
        project_id, run_id, agent_key, tool_key, tool_version, effect_key,
        status, input_redacted, output_redacted, duration_ms, started_at, completed_at
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, 'alex', ${call.name}, 1, ${key},
        ${status}, ${transaction.json({ arguments: call.arguments.slice(0, 2000) })},
        ${transaction.json(persistedOutput)}, ${Date.now() - startedAt}, now(), now()
      )
      on conflict (effect_key) do update set effect_key = excluded.effect_key
      returning id::text
    `;
    const sequenceRows = await transaction<
      Array<{ last_event_sequence: string }>
    >`
      update public.agent_runs
      set last_event_sequence = last_event_sequence + 1
      where id = ${run.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    const sequence = sequenceRows[0]?.last_event_sequence;
    if (!sequence) return;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary,
        detail, file_path, tool_invocation_id
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, 'alex', ${Number(sequence)},
        ${operation.filePath && status === "completed" ? "file.saved" : `tool.${status}`},
        ${status},
        ${status === "completed" ? `${call.name} 已完成` : `${call.name} 执行失败`},
        ${transaction.json(persistedOutput)}, ${operation.filePath},
        ${invocationRows[0]?.id ?? null}::uuid
      )
    `;
  });

  return {
    toolCallId: call.id,
    content: JSON.stringify(operation.output),
    filePath: operation.filePath,
  };
}
