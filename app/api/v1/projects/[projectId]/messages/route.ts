import { sendMessageSchema } from "@/lib/chat/schemas";
import { ChatRepository } from "@/lib/chat/repository";
import { errorResponse } from "@/lib/http/errors";
import {
  readJson,
  requestId as resolveRequestId,
  requireIdempotencyKey,
} from "@/lib/http/request";
import { projectIdSchema } from "@/lib/projects/schemas";
import { RunRepository } from "@/lib/runs/repository";
import { startPersistedAgentRun } from "@/lib/runs/service";
import { requireUser } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { projectId } = await context.params;
    const validProjectId = projectIdSchema.parse(projectId);
    const url = new URL(request.url);
    const after = Math.max(Number(url.searchParams.get("after") ?? 0), 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const { supabase } = await requireUser();
    const repository = new ChatRepository(supabase);
    const messages = await repository.list(validProjectId, after, limit);
    return Response.json({ data: messages, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveRequestId(request);
  try {
    const { projectId } = await context.params;
    const validProjectId = projectIdSchema.parse(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    const input = sendMessageSchema.parse(await readJson(request));
    const { supabase } = await requireUser();
    const repository = new ChatRepository(supabase);
    const result = await repository.send(validProjectId, input, idempotencyKey);
    if (!result.reused) {
      await startPersistedAgentRun(result.runId, new RunRepository(supabase));
    }
    return Response.json(
      { data: result, requestId },
      { status: result.reused ? 200 : 202 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
