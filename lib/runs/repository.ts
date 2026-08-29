import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/http/errors";

export type AgentRun = {
  id: string;
  projectId: string;
  mode: "engineer" | "team";
  scheduleStrategy: "automatic" | "user_selected";
  status:
    | "queued"
    | "planning"
    | "running"
    | "waiting_for_user"
    | "cancelling"
    | "cancelled"
    | "validating"
    | "completed"
    | "failed";
  lastEventSequence: number;
  cancelRequestedAt: string | null;
  failureCode: string | null;
  workflowRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export class RunRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(runId: string): Promise<AgentRun> {
    const { data, error } = await this.supabase
      .from("agent_runs")
      .select(
        "id,project_id,mode,schedule_strategy,status,last_event_sequence,cancel_requested_at,failure_code,workflow_run_id,created_at,updated_at",
      )
      .eq("id", runId)
      .maybeSingle();

    if (error) {
      throw new ApiError("RUN_READ_FAILED", 500, "任务状态加载失败。", true);
    }
    if (!data) {
      throw new ApiError("RUN_NOT_FOUND", 404, "任务不存在或无权访问。", false);
    }

    return {
      id: String(data.id),
      projectId: String(data.project_id),
      mode: data.mode as AgentRun["mode"],
      scheduleStrategy: data.schedule_strategy as AgentRun["scheduleStrategy"],
      status: data.status as AgentRun["status"],
      lastEventSequence: Number(data.last_event_sequence),
      cancelRequestedAt: data.cancel_requested_at ? String(data.cancel_requested_at) : null,
      failureCode: data.failure_code ? String(data.failure_code) : null,
      workflowRunId: data.workflow_run_id ? String(data.workflow_run_id) : null,
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
    };
  }

  async attachWorkflow(runId: string, workflowRunId: string) {
    const { error } = await this.supabase
      .from("agent_runs")
      .update({ workflow_run_id: workflowRunId })
      .eq("id", runId)
      .is("workflow_run_id", null);
    if (error) {
      throw new ApiError("WORKFLOW_ATTACH_FAILED", 500, "任务已创建，但执行器关联失败。", true);
    }
  }

  async failWorkflowStart(runId: string) {
    const { error } = await this.supabase.rpc("fail_run_workflow_start", {
      p_run_id: runId,
      p_failure_code: "WORKFLOW_START_FAILED",
    });
    if (error) {
      throw new ApiError(
        "WORKFLOW_START_FAILURE_PERSIST_FAILED",
        500,
        "执行器启动失败，且任务状态未能安全收口。",
        true,
      );
    }
  }

  async cancel(runId: string) {
    const { data, error } = await this.supabase.rpc("request_run_cancel", {
      p_run_id: runId,
    });
    if (error) {
      if (error.message.includes("RUN_NOT_FOUND")) {
        throw new ApiError("RUN_NOT_FOUND", 404, "任务不存在或无权访问。", false);
      }
      throw new ApiError("RUN_CANCEL_FAILED", 500, "停止请求提交失败。", true);
    }
    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) {
      throw new ApiError("RUN_CANCEL_FAILED", 500, "停止请求提交失败。", true);
    }
    return {
      runId: String(row.run_id),
      status: String(row.status),
      alreadyTerminal: Boolean(row.already_terminal),
    };
  }

  async confirmCancelled(runId: string) {
    const { data, error } = await this.supabase.rpc("confirm_run_cancelled", {
      p_run_id: runId,
    });
    if (error) {
      if (error.message.includes("RUN_NOT_FOUND")) {
        throw new ApiError("RUN_NOT_FOUND", 404, "任务不存在或无权访问。", false);
      }
      throw new ApiError("RUN_CANCEL_CONFIRM_FAILED", 500, "任务已停止，但状态确认失败。", true);
    }
    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) {
      throw new ApiError("RUN_CANCEL_CONFIRM_FAILED", 500, "任务已停止，但状态确认失败。", true);
    }
    return {
      runId: String(row.run_id),
      status: String(row.status),
      alreadyTerminal: Boolean(row.already_terminal),
    };
  }

  async events(runId: string, after: number, limit: number) {
    const { data, error } = await this.supabase
      .from("trace_events")
      .select(
        "id,project_id,run_id,agent_key,sequence,event_type,status,summary,detail,parent_event_id,correlation_id,file_path,terminal_session_id,tool_invocation_id,created_at",
      )
      .eq("run_id", runId)
      .gt("sequence", after)
      .order("sequence", { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 200));
    if (error) {
      throw new ApiError("EVENT_LIST_FAILED", 500, "执行记录加载失败。", true);
    }
    return data ?? [];
  }
}
