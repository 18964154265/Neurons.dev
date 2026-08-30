export type RunCancellationResult = {
  runId: string;
  status: string;
  alreadyTerminal: boolean;
};

type CancelRunDependencies = {
  requestCancellation: () => Promise<RunCancellationResult>;
  cancelWorkflow: () => Promise<void>;
  confirmCancelled: () => Promise<RunCancellationResult>;
  onWorkflowCancelError?: (error: unknown) => void;
  workflowCancelTimeoutMs?: number;
};

async function cancelWorkflowWithinTimeout(
  cancelWorkflow: () => Promise<void>,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cancelWorkflow(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("WORKFLOW_CANCEL_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function cancelRunAndReconcile({
  requestCancellation,
  cancelWorkflow,
  confirmCancelled,
  onWorkflowCancelError,
  workflowCancelTimeoutMs = 2_000,
}: CancelRunDependencies) {
  const cancellation = await requestCancellation();
  if (cancellation.alreadyTerminal) return cancellation;

  try {
    await cancelWorkflowWithinTimeout(cancelWorkflow, workflowCancelTimeoutMs);
  } catch (error) {
    // The database state is authoritative. A stale or unavailable workflow must
    // not leave the user-facing run permanently stuck in `cancelling`.
    onWorkflowCancelError?.(error);
  }

  return confirmCancelled();
}
