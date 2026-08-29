import "server-only";

import { getRun, start } from "workflow/api";

import { agentRunWorkflow } from "@/workflows/agent-run";

export async function startAgentRunWorkflow(runId: string) {
  const workflowRun = await start(agentRunWorkflow, [runId]);
  return workflowRun.runId;
}

export async function cancelAgentRunWorkflow(workflowRunId: string) {
  await getRun(workflowRunId).cancel();
}
