import { errorResponse } from "@/lib/http/errors";
import {
  readJson,
  requestId as resolveRequestId,
  requireIdempotencyKey,
} from "@/lib/http/request";
import { ProjectRepository } from "@/lib/projects/repository";
import { createProjectSchema } from "@/lib/projects/schemas";
import { ProjectService } from "@/lib/projects/service";
import { requireUser } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const { supabase } = await requireUser();
    const service = new ProjectService(new ProjectRepository(supabase));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 30);
    const projects = await service.list(Number.isFinite(limit) ? limit : 30);

    return Response.json({ data: projects, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const idempotencyKey = requireIdempotencyKey(request);
    const input = createProjectSchema.parse(await readJson(request));
    const { supabase } = await requireUser();
    const service = new ProjectService(new ProjectRepository(supabase));
    const result = await service.create(input, idempotencyKey);

    return Response.json(
      { data: result, requestId },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
