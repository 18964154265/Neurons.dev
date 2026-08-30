import { z } from "zod";

import { errorResponse } from "@/lib/http/errors";
import {
  requestId as resolveRequestId,
  requireIdempotencyKey,
} from "@/lib/http/request";
import { cancelRunAndReconcile } from "@/lib/runs/cancellation";
import { RunRepository } from "@/lib/runs/repository";
import { cancelAgentRunWorkflow } from "@/lib/runs/workflow";
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
    const run = await repository.get(validRunId);
    const result = await cancelRunAndReconcile({
      requestCancellation: () => repository.cancel(validRunId),
      cancelWorkflow: () =>
        run.workflowRunId
          ? cancelAgentRunWorkflow(run.workflowRunId)
          : Promise.resolve(),
      confirmCancelled: () => repository.confirmCancelled(validRunId),
      onWorkflowCancelError: (error) => {
        console.error(
          "Workflow cancellation failed; reconciling database run",
          {
            requestId,
            runId: validRunId,
            error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          },
        );
      },
    });
    return Response.json({ data: result, requestId }, { status: 202 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
