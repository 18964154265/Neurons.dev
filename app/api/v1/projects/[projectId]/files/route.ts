import { ProjectFileRepository } from "@/lib/files/repository";
import { errorResponse } from "@/lib/http/errors";
import { requestId as resolveRequestId } from "@/lib/http/request";
import { projectIdSchema } from "@/lib/projects/schemas";
import { requireUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { projectId } = await context.params;
    const validProjectId = projectIdSchema.parse(projectId);
    const { supabase } = await requireUser();
    const files = await new ProjectFileRepository(supabase).list(
      validProjectId,
    );
    return Response.json({ data: files, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
