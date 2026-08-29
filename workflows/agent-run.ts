import { runEngineerModelStep, prepareRunStep, completeRunStep, failRunStep } from "./steps";

export async function agentRunWorkflow(runId: string) {
  "use workflow";

  try {
    const run = await prepareRunStep(runId);
    const output = await runEngineerModelStep(run);
    await completeRunStep(run, output);
    return { runId, status: "completed" as const };
  } catch (error) {
    const failureCode = error instanceof Error ? error.message.slice(0, 120) : "RUN_FAILED";
    await failRunStep(runId, failureCode);
    return { runId, status: "failed" as const, failureCode };
  }
}
