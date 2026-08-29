import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/http/errors";

import type { CreateProjectResult, ProjectSummary } from "./types";

type CreateProjectCommand = {
  name: string;
  initialMessage: string;
  mode: "engineer" | "team";
  scheduleStrategy: "automatic" | "user_selected";
  agentKeys: string[];
  clientRequestId: string;
  requestHash: string;
};

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectSummary["status"];
  result_status: ProjectSummary["resultStatus"];
  default_mode: ProjectSummary["defaultMode"];
  default_schedule_strategy: ProjectSummary["defaultScheduleStrategy"];
  active_run_id: string | null;
  latest_successful_version_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

const projectSelection = [
  "id",
  "name",
  "status",
  "result_status",
  "default_mode",
  "default_schedule_strategy",
  "active_run_id",
  "latest_successful_version_id",
  "revision",
  "created_at",
  "updated_at",
].join(",");

function mapProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    resultStatus: row.result_status,
    defaultMode: row.default_mode,
    defaultScheduleStrategy: row.default_schedule_strategy,
    activeRunId: row.active_run_id,
    latestSuccessfulVersionId: row.latest_successful_version_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(command: CreateProjectCommand): Promise<CreateProjectResult> {
    const { data, error } = await this.supabase.rpc("create_project_with_run", {
      p_name: command.name,
      p_initial_message: command.initialMessage,
      p_mode: command.mode,
      p_schedule_strategy: command.scheduleStrategy,
      p_agent_keys: command.agentKeys,
      p_client_request_id: command.clientRequestId,
      p_request_hash: command.requestHash,
    });

    if (error) {
      if (error.message.includes("IDEMPOTENCY_KEY_REUSED")) {
        throw new ApiError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "该 Idempotency-Key 已用于不同的请求。",
        );
      }
      if (error.message.includes("UNKNOWN_OR_DISABLED_AGENT")) {
        throw new ApiError("INVALID_AGENT", 400, "选择了不可用的 Agent。", false);
      }
      throw new ApiError("PROJECT_CREATE_FAILED", 500, "项目创建失败，请重试。", true);
    }

    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) {
      throw new ApiError("PROJECT_CREATE_FAILED", 500, "项目创建失败，请重试。", true);
    }

    return {
      projectId: String(row.project_id),
      conversationId: String(row.conversation_id),
      messageId: String(row.message_id),
      runId: String(row.run_id),
      reused: Boolean(row.reused),
    };
  }

  async list(limit: number): Promise<ProjectSummary[]> {
    const { data, error } = await this.supabase
      .from("projects")
      .select(projectSelection)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new ApiError("PROJECT_LIST_FAILED", 500, "项目列表加载失败。", true);
    }
    return ((data ?? []) as unknown as ProjectRow[]).map(mapProject);
  }

  async get(projectId: string): Promise<ProjectSummary> {
    const { data, error } = await this.supabase
      .from("projects")
      .select(projectSelection)
      .eq("id", projectId)
      .is("archived_at", null)
      .maybeSingle();

    if (error) {
      throw new ApiError("PROJECT_READ_FAILED", 500, "项目加载失败。", true);
    }
    if (!data) {
      throw new ApiError("PROJECT_NOT_FOUND", 404, "项目不存在或无权访问。", false);
    }
    return mapProject(data as unknown as ProjectRow);
  }

  async update(
    projectId: string,
    revision: number,
    changes: {
      name?: string;
      defaultMode?: ProjectSummary["defaultMode"];
      defaultScheduleStrategy?: ProjectSummary["defaultScheduleStrategy"];
    },
  ): Promise<ProjectSummary> {
    const payload: Record<string, unknown> = { revision: revision + 1 };
    if (changes.name !== undefined) payload.name = changes.name;
    if (changes.defaultMode !== undefined) payload.default_mode = changes.defaultMode;
    if (changes.defaultScheduleStrategy !== undefined) {
      payload.default_schedule_strategy = changes.defaultScheduleStrategy;
    }

    const { data, error } = await this.supabase
      .from("projects")
      .update(payload)
      .eq("id", projectId)
      .eq("revision", revision)
      .is("archived_at", null)
      .select(projectSelection)
      .maybeSingle();

    if (error) {
      throw new ApiError("PROJECT_UPDATE_FAILED", 500, "项目更新失败。", true);
    }
    if (!data) {
      throw new ApiError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "项目已在其他位置更新，请刷新后重试。",
        false,
      );
    }
    return mapProject(data as unknown as ProjectRow);
  }
}
