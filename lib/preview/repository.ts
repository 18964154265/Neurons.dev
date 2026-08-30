import "server-only";

import { Sandbox } from "@vercel/sandbox";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/http/errors";
import type { ProjectPreview } from "@/lib/preview/types";
import { resolveSandboxAccessCredentials } from "@/lib/tools/sandbox-credentials";

type SandboxSessionRow = {
  provider_sandbox_id: string;
  status: "creating" | "ready" | "busy" | "hibernating" | "stopped" | "failed";
  preview_port: number | null;
  preview_url_expires_at: string | null;
  updated_at: string;
};

export class PreviewRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(projectId: string): Promise<ProjectPreview | null> {
    const { data, error } = await this.supabase
      .from("sandbox_sessions")
      .select(
        "provider_sandbox_id,status,preview_port,preview_url_expires_at,updated_at",
      )
      .eq("project_id", projectId)
      .not("preview_port", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new ApiError(
        "PREVIEW_READ_FAILED",
        500,
        "Web Preview 状态加载失败。",
        true,
      );
    }
    if (!data) return null;

    const row = data as SandboxSessionRow;
    const port = Number(row.preview_port);
    const status =
      row.status === "ready"
        ? "ready"
        : row.status === "failed" || row.status === "stopped"
          ? "failed"
          : "starting";
    let url: string | null = null;
    if (status === "ready") {
      try {
        const sandbox = await Sandbox.get({
          name: row.provider_sandbox_id,
          ...resolveSandboxAccessCredentials(process.env),
        });
        url = sandbox.domain(port);
      } catch (error) {
        throw new ApiError(
          "PREVIEW_URL_RESOLVE_FAILED",
          503,
          "Web Preview 地址暂时不可用，请让 Agent 重新启动预览。",
          true,
          {
            location: "lib/preview/repository.PreviewRepository.get",
            cause: error instanceof Error ? error.name : "UNKNOWN",
          },
        );
      }
    }
    return {
      kind: "sandbox",
      status,
      url,
      port,
      expiresAt: row.preview_url_expires_at,
      updatedAt: row.updated_at,
    };
  }
}
