import { ApiError } from "@/lib/http/errors";
import type { RunRepository } from "@/lib/runs/repository";
import { startAgentRunWorkflow } from "@/lib/runs/workflow";

export async function startPersistedAgentRun(runId: string, repository: RunRepository) {
  try {
    const workflowRunId = await startAgentRunWorkflow(runId);
    await repository.attachWorkflow(runId, workflowRunId);
    return workflowRunId;
  } catch {
    await repository.failWorkflowStart(runId);
    throw new ApiError(
      "WORKFLOW_START_FAILED",
      503,
      "项目已创建，但任务执行器暂时不可用，请稍后发送新消息重试。",
      true,
    );
  }
}
