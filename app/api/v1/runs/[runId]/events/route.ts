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
    const url = new URL(request.url);
    const after = Math.max(Number(url.searchParams.get("after") ?? 0), 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const { supabase } = await requireUser();
    const events = await new RunRepository(supabase).events(validRunId, after, limit);
    return Response.json({ data: events, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
