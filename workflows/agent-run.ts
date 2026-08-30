import {
  beginAgentTurnStep,
  completeAgentTurnStep,
  runAgentModelStep,
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
    const outputs: Array<{
      agentKey: (typeof run.agentKeys)[number];
      text: string;
    }> = [];
    let previousAgentKey: (typeof run.agentKeys)[number] | null = null;
    for (const agentKey of run.agentKeys) {
      const turn = await beginAgentTurnStep(run, agentKey, previousAgentKey);
      const output = await runAgentModelStep(turn, outputs);
      await completeAgentTurnStep(turn, output);
      outputs.push({ agentKey, text: output.text });
      previousAgentKey = agentKey;
    }
    await completeRunStep(run);
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
          location: "workflows/steps.runAgentModelStep:model",
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
