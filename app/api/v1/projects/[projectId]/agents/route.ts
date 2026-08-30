import { errorResponse } from "@/lib/http/errors";
import { requestId as resolveRequestId } from "@/lib/http/request";
import { ApiError } from "@/lib/http/errors";
import { agentDefinitions } from "@/lib/agents/registry";
import { projectIdSchema } from "@/lib/projects/schemas";
import { requireUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { projectId } = await context.params;
    const validProjectId = projectIdSchema.parse(projectId);
    const { supabase } = await requireUser();
    const [definitionsResult, assignmentsResult] = await Promise.all([
      supabase
        .from("agent_definitions_projection")
        .select(
          "agent_key,definition_version,display_name,description,avatar_path,tool_labels",
        )
        .eq("enabled", true)
        .order("display_name"),
      supabase
        .from("project_agent_assignments")
        .select("agent_key,definition_version,status,assigned_run_id")
        .eq("project_id", validProjectId)
        .is("removed_at", null),
    ]);

    if (definitionsResult.error || assignmentsResult.error) {
      throw new ApiError(
        "AGENT_LIST_FAILED",
        500,
        "Agent 列表加载失败。",
        true,
      );
    }
    const assignments = new Map(
      (assignmentsResult.data ?? []).map((assignment) => [
        assignment.agent_key,
        assignment,
      ]),
    );
    const executableToolsByAgent = new Map(
      agentDefinitions.map((definition) => [
        definition.key,
        definition.tools.map((tool) => tool.name),
      ]),
    );
    const agents = (definitionsResult.data ?? []).map((definition) => {
      const assignment = assignments.get(definition.agent_key);
      return {
        key: definition.agent_key,
        version: definition.definition_version,
        name: definition.display_name,
        description: definition.description,
        avatarPath: definition.avatar_path,
        tools: executableToolsByAgent.get(definition.agent_key) ?? [],
        assigned: Boolean(assignment),
        status: assignment?.status ?? null,
        runId: assignment?.assigned_run_id ?? null,
      };
    });

    return Response.json({ data: agents, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
