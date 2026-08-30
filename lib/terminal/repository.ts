import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/http/errors";
import type { TerminalChunk, TerminalSession } from "@/lib/terminal/types";

export class TerminalRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async list(projectId: string): Promise<TerminalSession[]> {
    const { data: sessions, error: sessionsError } = await this.supabase
      .from("terminal_sessions")
      .select(
        "id,run_id,agent_key,command_summary,cwd,status,started_at,completed_at",
      )
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(20);

    if (sessionsError) {
      throw new ApiError(
        "TERMINAL_SESSIONS_READ_FAILED",
        500,
        "Terminal 会话加载失败。",
        true,
      );
    }

    const sessionIds = (sessions ?? []).map((session) => String(session.id));
    if (!sessionIds.length) return [];

    const { data: chunks, error: chunksError } = await this.supabase
      .from("terminal_chunks")
      .select(
        "id,terminal_session_id,sequence,stream,content,byte_length,created_at",
      )
      .in("terminal_session_id", sessionIds)
      .order("sequence", { ascending: true });

    if (chunksError) {
      throw new ApiError(
        "TERMINAL_CHUNKS_READ_FAILED",
        500,
        "Terminal 输出加载失败。",
        true,
      );
    }

    const chunksBySession = new Map<string, TerminalChunk[]>();
    for (const chunk of chunks ?? []) {
      const sessionId = String(chunk.terminal_session_id);
      const values = chunksBySession.get(sessionId) ?? [];
      values.push({
        id: String(chunk.id),
        sequence: Number(chunk.sequence),
        stream: chunk.stream === "stderr" ? "stderr" : "stdout",
        content: String(chunk.content ?? ""),
        byteLength: Number(chunk.byte_length),
        createdAt: String(chunk.created_at),
      });
      chunksBySession.set(sessionId, values);
    }

    return (sessions ?? []).map((session) => ({
      id: String(session.id),
      runId: session.run_id ? String(session.run_id) : null,
      agentKey: session.agent_key ? String(session.agent_key) : null,
      commandSummary: String(session.command_summary),
      cwd: String(session.cwd),
      status: session.status as TerminalSession["status"],
      startedAt: String(session.started_at),
      completedAt: session.completed_at ? String(session.completed_at) : null,
      chunks: chunksBySession.get(String(session.id)) ?? [],
    }));
  }
}
