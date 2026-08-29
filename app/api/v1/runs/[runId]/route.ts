import { z } from "zod";

import { errorResponse } from "@/lib/http/errors";
import { requestId as resolveRequestId } from "@/lib/http/request";
import { RunRepository } from "@/lib/runs/repository";
import { requireUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { runId } = await context.params;
    const validRunId = z.string().uuid().parse(runId);
    const { supabase } = await requireUser();
    const run = await new RunRepository(supabase).get(validRunId);
    return Response.json({ data: run, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
