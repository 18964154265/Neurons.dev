import { errorResponse } from "@/lib/http/errors";
import { readJson, requestId as resolveRequestId } from "@/lib/http/request";
import { ProjectRepository } from "@/lib/projects/repository";
import { projectIdSchema, updateProjectSchema } from "@/lib/projects/schemas";
import { ProjectService } from "@/lib/projects/service";
import { requireUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { projectId } = await context.params;
    const validProjectId = projectIdSchema.parse(projectId);
    const { supabase } = await requireUser();
    const service = new ProjectService(new ProjectRepository(supabase));
    const project = await service.get(validProjectId);

    return Response.json({ data: project, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { projectId } = await context.params;
    const validProjectId = projectIdSchema.parse(projectId);
    const input = updateProjectSchema.parse(await readJson(request));
    const { supabase } = await requireUser();
    const service = new ProjectService(new ProjectRepository(supabase));
    const project = await service.update(validProjectId, input);

    return Response.json({ data: project, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
