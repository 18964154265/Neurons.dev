import {
  runEngineerModelStep,
  prepareRunStep,
  completeRunStep,
  failRunStep,
} from "./steps";
import { extractRunFailureCode } from "@/lib/runs/failure";
import { extractModelFailure } from "@/lib/llm/errors";
import { extractLocatedError } from "@/lib/errors/located";

export async function agentRunWorkflow(runId: string) {
  "use workflow";

  try {
    const run = await prepareRunStep(runId);
    const output = await runEngineerModelStep(run);
    await completeRunStep(run, output);
    return { runId, status: "completed" as const };
  } catch (error) {
    const modelFailure = extractModelFailure(error);
    const internalFailure = extractLocatedError(error);
    const failureCode =
      modelFailure?.code ??
      internalFailure?.code ??
      extractRunFailureCode(error);
    const failureDetail = modelFailure
      ? {
          location: "workflows/steps.runEngineerModelStep:model",
          provider: modelFailure.provider,
        }
      : internalFailure
        ? {
            location: internalFailure.location,
            message: internalFailure.message,
          }
        : {
            location: "workflows/agent-run.agentRunWorkflow",
          };
    await failRunStep(runId, failureCode, failureDetail);
    return { runId, status: "failed" as const, failureCode };
  }
}
