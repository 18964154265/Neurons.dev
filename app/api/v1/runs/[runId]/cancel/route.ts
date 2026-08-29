import { z } from "zod";

import { errorResponse } from "@/lib/http/errors";
import { requestId as resolveRequestId, requireIdempotencyKey } from "@/lib/http/request";
import { RunRepository } from "@/lib/runs/repository";
import { requireUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    requireIdempotencyKey(request);
    const { runId } = await context.params;
    const validRunId = z.string().uuid().parse(runId);
    const { supabase } = await requireUser();
    const repository = new RunRepository(supabase);
    const result = await repository.cancel(validRunId);
    return Response.json({ data: result, requestId }, { status: 202 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
