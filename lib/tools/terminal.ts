import "server-only";

import { dirname, posix } from "node:path";

import { Sandbox } from "@vercel/sandbox";

import { getDatabase } from "@/lib/db/postgres";
import type { PreparedAgentTurn } from "@/lib/runs/worker-store";
import { resolveSandboxAccessCredentials } from "@/lib/tools/sandbox-credentials";
import {
  terminalRunInputSchema,
  type TerminalRunInput,
} from "@/lib/terminal/types";

const MAX_PERSISTED_OUTPUT_BYTES = 512 * 1024;
const MAX_CHUNK_BYTES = 16_000;
const OUTPUT_FLUSH_BYTES = 8_000;
const OUTPUT_FLUSH_INTERVAL_MS = 200;
const OUTPUT_TAIL_CHARACTERS = 24_000;
export const sandboxNetworkPolicy = {
  allow: [
    "registry.npmjs.org",
    "*.npmjs.org",
    "registry.yarnpkg.com",
    "github.com",
    "*.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
  ],
};
const blockedExecutables = new Set([
  "bash",
  "dd",
  "fish",
  "kill",
  "mkfs",
  "mount",
  "pkill",
  "reboot",
  "rm",
  "sh",
  "shutdown",
  "sudo",
  "umount",
  "zsh",
]);

function validateCommand(input: TerminalRunInput) {
  if (blockedExecutables.has(input.command.toLowerCase())) {
    throw new Error(`TERMINAL_COMMAND_BLOCKED:${input.command}`);
  }
}

function safeTerminalError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 240);
}

function splitOutput(value: string) {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + bytes > MAX_CHUNK_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function appendTerminalTrace(
  run: PreparedAgentTurn,
  terminalSessionId: string,
  eventType: string,
  status: "started" | "progress" | "completed" | "failed",
  summary: string,
  detail: Record<string, unknown>,
) {
  const sql = getDatabase();
  const persistedDetail = JSON.parse(JSON.stringify(detail));
  await sql.begin(async (transaction) => {
    const rows = await transaction<Array<{ sequence: string }>>`
      update public.agent_runs
      set last_event_sequence = last_event_sequence + 1
      where id = ${run.runId}::uuid and status = 'running'
      returning last_event_sequence::text as sequence
    `;
    const sequence = rows[0]?.sequence;
    if (!sequence) return;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary,
        detail, terminal_session_id
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, ${run.agentKey},
        ${Number(sequence)}, ${eventType}, ${status}, ${summary},
        ${transaction.json(persistedDetail)}, ${terminalSessionId}::uuid
      )
    `;
  });
}

export async function syncProjectFiles(sandbox: Sandbox, projectId: string) {
  const sql = getDatabase();
  const files = await sql<Array<{ path: string; content: string }>>`
    select path, content
    from public.project_files
    where project_id = ${projectId}::uuid
    order by path
    limit 500
  `;
  const directories = [
    ...new Set(
      files
        .map((file) => dirname(file.path))
        .filter((directory) => directory !== "."),
    ),
  ].sort((left, right) => left.split("/").length - right.split("/").length);
  for (const directory of directories) {
    await sandbox.mkDir(posix.join(sandbox.cwd, directory));
  }
  if (files.length) {
    await sandbox.writeFiles(
      files.map((file) => ({
        path: posix.join(sandbox.cwd, file.path),
        content: file.content,
      })),
    );
  }
}

export async function getProjectSandbox(projectId: string, ports?: number[]) {
  const sandbox = await Sandbox.getOrCreate({
    name: `neurons-${projectId}`,
    timeout: 5 * 60_000,
    persistent: true,
    resources: { vcpus: 2 },
    networkPolicy: sandboxNetworkPolicy,
    ports,
    ...resolveSandboxAccessCredentials(process.env),
  });
  await sandbox.update({
    networkPolicy: sandboxNetworkPolicy,
    ...(ports ? { ports } : {}),
  });
  return sandbox;
}

export async function executeTerminalCommand(
  run: PreparedAgentTurn,
  value: unknown,
) {
  const input = terminalRunInputSchema.parse(value);
  validateCommand(input);
  const sql = getDatabase();
  const sandbox = await getProjectSandbox(run.projectId);
  await syncProjectFiles(sandbox, run.projectId);
  await sql`
    insert into public.sandbox_sessions (
      project_id, provider_sandbox_id, status, last_activity_at, expires_at
    ) values (
      ${run.projectId}::uuid, ${sandbox.name}, 'busy', now(), ${sandbox.expiresAt ?? null}
    )
    on conflict (provider_sandbox_id) do update
    set status = 'busy', last_activity_at = now(), expires_at = excluded.expires_at
  `;

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
  if (!terminalSessionId) throw new Error("TERMINAL_SESSION_CREATE_FAILED");

  await appendTerminalTrace(
    run,
    terminalSessionId,
    "terminal.started",
    "started",
    `${input.command} 已启动`,
    { command: input.command, argCount: input.args.length, cwd: input.cwd },
  );

  let sequence = 0;
  let persistedBytes = 0;
  let truncated = false;
  let stdout = "";
  let stderr = "";
  let bufferedStream: "stdout" | "stderr" | null = null;
  let bufferedOutput = "";
  let lastOutputFlushAt = Date.now();

  const persistOutput = async (
    stream: "stdout" | "stderr",
    content: string,
  ) => {
    for (const chunk of splitOutput(content)) {
      const byteLength = Buffer.byteLength(chunk, "utf8");
      if (persistedBytes + byteLength > MAX_PERSISTED_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      sequence += 1;
      persistedBytes += byteLength;
      await sql`
        insert into public.terminal_chunks (
          project_id, terminal_session_id, sequence, stream, content, byte_length
        ) values (
          ${run.projectId}::uuid, ${terminalSessionId}::uuid, ${sequence},
          ${stream}, ${chunk}, ${byteLength}
        )
      `;
      await appendTerminalTrace(
        run,
        terminalSessionId,
        "terminal.output",
        "progress",
        `${stream} 输出 ${byteLength} bytes`,
        { stream, sequence, byteLength },
      );
    }
  };

  const flushOutput = async () => {
    if (!bufferedStream || !bufferedOutput) return;
    const stream = bufferedStream;
    const content = bufferedOutput;
    bufferedStream = null;
    bufferedOutput = "";
    lastOutputFlushAt = Date.now();
    await persistOutput(stream, content);
  };

  try {
    const command = await sandbox.runCommand({
      cmd: input.command,
      args: input.args,
      cwd: input.cwd === "." ? sandbox.cwd : posix.join(sandbox.cwd, input.cwd),
      timeoutMs: input.timeoutMs,
      detached: true,
    });
    for await (const log of command.logs()) {
      if (log.stream === "stdout") {
        stdout = `${stdout}${log.data}`.slice(-OUTPUT_TAIL_CHARACTERS);
      } else {
        stderr = `${stderr}${log.data}`.slice(-OUTPUT_TAIL_CHARACTERS);
      }
      if (bufferedStream && bufferedStream !== log.stream) await flushOutput();
      bufferedStream = log.stream;
      bufferedOutput += log.data;
      if (
        Buffer.byteLength(bufferedOutput, "utf8") >= OUTPUT_FLUSH_BYTES ||
        Date.now() - lastOutputFlushAt >= OUTPUT_FLUSH_INTERVAL_MS
      ) {
        await flushOutput();
      }
    }
    await flushOutput();
    const result = await command.wait();
    const status = result.exitCode === 0 ? "completed" : "failed";
    await sql.begin(async (transaction) => {
      await transaction`
        update public.terminal_sessions
        set status = ${status}, completed_at = now()
        where id = ${terminalSessionId}::uuid
      `;
      await transaction`
        update public.sandbox_sessions
        set status = 'ready', last_activity_at = now(), expires_at = ${sandbox.expiresAt ?? null}
        where provider_sandbox_id = ${sandbox.name}
      `;
    });
    await appendTerminalTrace(
      run,
      terminalSessionId,
      status === "completed" ? "terminal.completed" : "terminal.failed",
      status,
      `${input.command} 退出，exit code ${result.exitCode}`,
      {
        command: input.command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        outputTruncated: truncated,
      },
    );
    return {
      ok: result.exitCode === 0,
      terminalSessionId,
      command: input.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs ?? null,
      stdout,
      stderr,
      outputTruncated: truncated,
    };
  } catch (error) {
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
    });
    await appendTerminalTrace(
      run,
      terminalSessionId,
      "terminal.failed",
      "failed",
      `${input.command} 执行失败`,
      {
        command: input.command,
        error: safeTerminalError(error),
        location: "lib/tools/terminal.executeTerminalCommand",
      },
    );
    throw error;
  }
}
