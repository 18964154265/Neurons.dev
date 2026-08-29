import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { ApiError } from "@/lib/http/errors";

import type { sendMessageSchema } from "./schemas";

type SendMessageInput = z.infer<typeof sendMessageSchema>;

export type ConversationMessage = {
  id: string;
  projectId: string;
  runId: string | null;
  agentKey: string | null;
  sequence: number;
  role: "user" | "assistant" | "system_event";
  kind: "text" | "thought_summary" | "tool_summary" | "status" | "error" | "approval";
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  content: Record<string, unknown>;
  createdAt: string;
};

function requestHash(input: SendMessageInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        agentKeys: [...input.agentKeys].sort(),
      }),
    )
    .digest("hex");
}

export class ChatRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async send(projectId: string, input: SendMessageInput, idempotencyKey: string) {
    const { data, error } = await this.supabase.rpc("append_message_with_run", {
      p_project_id: projectId,
      p_message: input.message,
      p_mode: input.mode,
      p_schedule_strategy: input.scheduleStrategy,
      p_agent_keys: input.agentKeys,
      p_client_request_id: idempotencyKey,
      p_request_hash: requestHash(input),
    });

    if (error) {
      if (error.message.includes("PROJECT_HAS_ACTIVE_RUN")) {
        throw new ApiError(
          "PROJECT_BUSY",
          409,
          "当前任务仍在执行，请停止或等待完成后再发送。",
          false,
        );
      }
      if (error.message.includes("PROJECT_NOT_FOUND")) {
        throw new ApiError("PROJECT_NOT_FOUND", 404, "项目不存在或无权访问。", false);
      }
      if (error.message.includes("IDEMPOTENCY_KEY_REUSED")) {
        throw new ApiError("IDEMPOTENCY_CONFLICT", 409, "幂等键已用于其他消息。", false);
      }
      throw new ApiError("MESSAGE_SEND_FAILED", 500, "消息发送失败，请重试。", true);
    }

    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) {
      throw new ApiError("MESSAGE_SEND_FAILED", 500, "消息发送失败，请重试。", true);
    }
    return {
      messageId: String(row.message_id),
      runId: String(row.run_id),
      sequence: Number(row.sequence),
      reused: Boolean(row.reused),
    };
  }

  async list(projectId: string, after: number, limit: number): Promise<ConversationMessage[]> {
    const { data, error } = await this.supabase
      .from("messages")
      .select("id,project_id,run_id,agent_key,sequence,role,kind,status,content,created_at")
      .eq("project_id", projectId)
      .gt("sequence", after)
      .order("sequence", { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 100));

    if (error) {
      throw new ApiError("MESSAGE_LIST_FAILED", 500, "对话加载失败。", true);
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      runId: row.run_id ? String(row.run_id) : null,
      agentKey: row.agent_key ? String(row.agent_key) : null,
      sequence: Number(row.sequence),
      role: row.role as ConversationMessage["role"],
      kind: row.kind as ConversationMessage["kind"],
      status: row.status as ConversationMessage["status"],
      content: (row.content ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at),
    }));
  }
}
