import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectFile } from "@/lib/files/project-file";
import { ApiError } from "@/lib/http/errors";

export class ProjectFileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async list(projectId: string): Promise<ProjectFile[]> {
    const { data, error } = await this.supabase
      .from("project_files")
      .select(
        "path,content,language,revision,checksum,source_run_id,source_agent_key,updated_at",
      )
      .eq("project_id", projectId)
      .order("path", { ascending: true });

    if (error) {
      throw new ApiError(
        "PROJECT_FILES_READ_FAILED",
        500,
        "项目文件加载失败。",
        true,
      );
    }

    return (data ?? []).map((file) => ({
      path: String(file.path),
      content: String(file.content),
      language: String(file.language),
      revision: Number(file.revision),
      checksum: String(file.checksum),
      sourceRunId: file.source_run_id ? String(file.source_run_id) : null,
      sourceAgentKey: file.source_agent_key
        ? String(file.source_agent_key)
        : null,
      updatedAt: String(file.updated_at),
    }));
  }
}
