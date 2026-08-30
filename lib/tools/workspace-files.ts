import "server-only";

import { createHash } from "node:crypto";

import { ZodError } from "zod";

import { resolveAgentDefinition } from "@/lib/agents/registry";
import { getDatabase } from "@/lib/db/postgres";
import {
  codingInputSchema,
  languageForProjectFile,
  listProjectFilesInputSchema,
  readProjectFileInputSchema,
} from "@/lib/files/project-file";
import type { LLMToolCall } from "@/lib/llm/types";
import type { PreparedAgentTurn } from "@/lib/runs/worker-store";

export type WorkspaceToolResult = {
  toolCallId: string;
  content: string;
  filePath: string | null;
  delegatedAgentKey: null;
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

async function emitCodingStarted(run: PreparedAgentTurn, input: unknown) {
  const { summary, files } = codingInputSchema.parse(input);
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const rows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set last_event_sequence = last_event_sequence + 1
      where id = ${run.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    if (!rows[0]) return;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, ${run.agentKey},
        ${Number(rows[0].last_event_sequence)}, 'coding.started', 'started',
        ${summary}, ${transaction.json({ files: files.map((file) => file.path) })}
      )
    `;
  });
}

async function executeWorkspaceOperation(
  run: PreparedAgentTurn,
  call: LLMToolCall,
): Promise<{ output: Record<string, unknown>; filePaths: string[] }> {
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
    return { output: { ok: true, files }, filePaths: [] };
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
      filePaths: [path],
    };
  }

  if (call.name === "coding") {
    const { summary, files } = codingInputSchema.parse(input);
    const writtenFiles = await sql.begin(async (transaction) => {
      const results = [];
      for (const { path, content } of files) {
        const checksum = createHash("sha256").update(content).digest("hex");
        const language = languageForProjectFile(path);
        const rows = await transaction<Array<{ revision: number }>>`
          insert into public.project_files (
            project_id, path, content, language, checksum, source_run_id, source_agent_key
          ) values (
            ${run.projectId}::uuid, ${path}, ${content}, ${language}, ${checksum},
            ${run.runId}::uuid, ${run.agentKey}
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
        results.push({
          path,
          revision: rows[0]?.revision,
          checksum,
          bytes: Buffer.byteLength(content, "utf8"),
        });
      }
      return results;
    });
    return {
      output: {
        ok: true,
        summary,
        files: writtenFiles,
      },
      filePaths: files.map((file) => file.path),
    };
  }

  throw new Error(`TOOL_NOT_IMPLEMENTED:${call.name}`);
}

export async function executeWorkspaceToolCall(
  run: PreparedAgentTurn,
  call: LLMToolCall,
): Promise<WorkspaceToolResult> {
  const definition = resolveAgentDefinition(run.agentKey);
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
    if (call.name === "coding") {
      await emitCodingStarted(run, parseArguments(call));
    }
    operation = await executeWorkspaceOperation(run, call);
  } catch (error) {
    status = "failed";
    operation = { output: safeToolError(error), filePaths: [] };
  }
  const persistedOutput = JSON.parse(JSON.stringify(operation.output));

  await sql.begin(async (transaction) => {
    const invocationRows = await transaction<Array<{ id: string }>>`
      insert into public.tool_invocations (
        project_id, run_id, agent_key, tool_key, tool_version, effect_key,
        status, input_redacted, output_redacted, duration_ms, started_at, completed_at
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, ${run.agentKey}, ${call.name}, 1, ${key},
        ${status}, ${transaction.json({ arguments: call.arguments.slice(0, 2000) })},
        ${transaction.json(persistedOutput)}, ${Date.now() - startedAt}, now(), now()
      )
      on conflict (effect_key) do update set effect_key = excluded.effect_key
      returning id::text
    `;
    const eventPaths =
      call.name === "coding" && status === "completed"
        ? operation.filePaths
        : [null];
    for (const filePath of eventPaths) {
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
          ${run.projectId}::uuid, ${run.runId}::uuid, ${run.agentKey}, ${Number(sequence)},
          ${filePath ? "file.saved" : `tool.${status}`}, ${status},
          ${
            filePath
              ? `已写入 ${filePath}`
              : status === "completed"
                ? `${call.name} 已完成`
                : `${call.name} 执行失败`
          },
          ${transaction.json(persistedOutput)}, ${filePath},
          ${invocationRows[0]?.id ?? null}::uuid
        )
      `;
    }
  });

  return {
    toolCallId: call.id,
    content: JSON.stringify(operation.output),
    filePath: operation.filePaths[0] ?? null,
    delegatedAgentKey: null,
  };
}
