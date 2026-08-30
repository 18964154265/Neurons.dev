import "server-only";

import { posix } from "node:path";

import { getDatabase } from "@/lib/db/postgres";
import {
  previewStartInputSchema,
  type PreviewStartInput,
} from "@/lib/preview/types";
import type { PreparedAgentTurn } from "@/lib/runs/worker-store";
import {
  appendTerminalTrace,
  getProjectSandbox,
  syncProjectFiles,
} from "@/lib/tools/terminal";

const POLL_INTERVAL_MS = 400;

function safePreviewError(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 240);
}

async function waitForPreview(
  url: string,
  commandExit: Promise<{ exitCode: number }>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await Promise.race([
      commandExit.then((result) => ({ type: "exit" as const, result })),
      fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) })
        .then((response) => ({ type: "response" as const, response }))
        .catch(() => ({ type: "pending" as const })),
    ]);
    if (outcome.type === "exit") {
      throw new Error(`PREVIEW_PROCESS_EXITED:${outcome.result.exitCode}`);
    }
    if (outcome.type === "response" && outcome.response.status < 500) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("PREVIEW_START_TIMEOUT");
}

export async function executePreviewStart(
  run: PreparedAgentTurn,
  value: unknown,
) {
  const input: PreviewStartInput = previewStartInputSchema.parse(value);
  const sql = getDatabase();
  const sandbox = await getProjectSandbox(run.projectId, [input.port]);
  await syncProjectFiles(sandbox, run.projectId);

  const sessionRows = await sql<Array<{ id: string }>>`
    insert into public.terminal_sessions (
      project_id, run_id, agent_key, command_summary, cwd, status
    ) values (
      ${run.projectId}::uuid, ${run.runId}::uuid, ${run.agentKey},
      ${input.summary}, ${input.cwd}, 'started'
    )
    returning id::text
  `;
  const terminalSessionId = sessionRows[0]?.id;
  if (!terminalSessionId) throw new Error("PREVIEW_SESSION_CREATE_FAILED");

  await sql`
    insert into public.sandbox_sessions (
      project_id, provider_sandbox_id, status, preview_port,
      preview_url_expires_at, last_activity_at, expires_at
    ) values (
      ${run.projectId}::uuid, ${sandbox.name}, 'busy', ${input.port},
      ${sandbox.expiresAt ?? null}, now(), ${sandbox.expiresAt ?? null}
    )
    on conflict (provider_sandbox_id) do update
    set status = 'busy', preview_port = excluded.preview_port,
        preview_url_expires_at = excluded.preview_url_expires_at,
        last_activity_at = now(), expires_at = excluded.expires_at
  `;
  await appendTerminalTrace(
    run,
    terminalSessionId,
    "preview.starting",
    "started",
    `正在启动 Web Preview（端口 ${input.port}）`,
    { script: input.script, cwd: input.cwd, port: input.port },
  );

  try {
    const command = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", input.script, "--", ...input.args],
      cwd: input.cwd === "." ? sandbox.cwd : posix.join(sandbox.cwd, input.cwd),
      detached: true,
    });
    const url = sandbox.domain(input.port);
    await waitForPreview(url, command.wait(), input.startupTimeoutMs);
    await sql.begin(async (transaction) => {
      await transaction`
        update public.terminal_sessions
        set status = 'progress'
        where id = ${terminalSessionId}::uuid
      `;
      await transaction`
        update public.sandbox_sessions
        set status = 'ready', preview_port = ${input.port},
            preview_url_expires_at = ${sandbox.expiresAt ?? null},
            last_activity_at = now(), expires_at = ${sandbox.expiresAt ?? null}
        where provider_sandbox_id = ${sandbox.name}
      `;
      const readyMessage = `Web Preview ready: ${url}\n`;
      await transaction`
        insert into public.terminal_chunks (
          project_id, terminal_session_id, sequence, stream, content, byte_length
        ) values (
          ${run.projectId}::uuid, ${terminalSessionId}::uuid, 1, 'stdout',
          ${readyMessage}, ${Buffer.byteLength(readyMessage, "utf8")}
        )
      `;
    });
    await appendTerminalTrace(
      run,
      terminalSessionId,
      "preview.ready",
      "completed",
      "Web Preview 已就绪",
      { port: input.port, script: input.script },
    );
    return {
      ok: true,
      status: "ready",
      port: input.port,
      url,
      terminalSessionId,
    };
  } catch (error) {
    const errorMessage = `Web Preview failed: ${safePreviewError(error)}\n`;
    await sql.begin(async (transaction) => {
      await transaction`
        update public.terminal_sessions
        set status = 'failed', completed_at = now()
        where id = ${terminalSessionId}::uuid
      `;
      await transaction`
        update public.sandbox_sessions
        set status = 'failed', last_activity_at = now()
        where provider_sandbox_id = ${sandbox.name}
      `;
      await transaction`
        insert into public.terminal_chunks (
          project_id, terminal_session_id, sequence, stream, content, byte_length
        ) values (
          ${run.projectId}::uuid, ${terminalSessionId}::uuid, 1, 'stderr',
          ${errorMessage}, ${Buffer.byteLength(errorMessage, "utf8")}
        )
      `;
    });
    await appendTerminalTrace(
      run,
      terminalSessionId,
      "preview.failed",
      "failed",
      "Web Preview 启动失败",
      {
        port: input.port,
        script: input.script,
        error: safePreviewError(error),
        location: "lib/tools/preview.executePreviewStart",
      },
    );
    throw error;
  }
}
