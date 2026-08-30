import { describe, expect, it, vi } from "vitest";

import { cancelRunAndReconcile } from "@/lib/runs/cancellation";

const cancelling = {
  runId: "run-1",
  status: "cancelling",
  alreadyTerminal: false,
};
const cancelled = {
  runId: "run-1",
  status: "cancelled",
  alreadyTerminal: false,
};

describe("cancelRunAndReconcile", () => {
  it("cancels the workflow before confirming the database run", async () => {
    const calls: string[] = [];

    const result = await cancelRunAndReconcile({
      requestCancellation: async () => {
        calls.push("request");
        return cancelling;
      },
      cancelWorkflow: async () => {
        calls.push("workflow");
      },
      confirmCancelled: async () => {
        calls.push("confirm");
        return cancelled;
      },
    });

    expect(calls).toEqual(["request", "workflow", "confirm"]);
    expect(result.status).toBe("cancelled");
  });

  it("still confirms cancellation when the workflow is stale", async () => {
    const onWorkflowCancelError = vi.fn();
    const confirmCancelled = vi.fn(async () => cancelled);

    const result = await cancelRunAndReconcile({
      requestCancellation: async () => cancelling,
      cancelWorkflow: async () => {
        throw new Error("WORKFLOW_NOT_FOUND");
      },
      confirmCancelled,
      onWorkflowCancelError,
    });

    expect(confirmCancelled).toHaveBeenCalledOnce();
    expect(onWorkflowCancelError).toHaveBeenCalledOnce();
    expect(result.status).toBe("cancelled");
  });

  it("bounds a hanging workflow cancellation before confirming", async () => {
    const onWorkflowCancelError = vi.fn();
    const confirmCancelled = vi.fn(async () => cancelled);

    const result = await cancelRunAndReconcile({
      requestCancellation: async () => cancelling,
      cancelWorkflow: () => new Promise(() => undefined),
      confirmCancelled,
      onWorkflowCancelError,
      workflowCancelTimeoutMs: 1,
    });

    expect(confirmCancelled).toHaveBeenCalledOnce();
    expect(onWorkflowCancelError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "WORKFLOW_CANCEL_TIMEOUT" }),
    );
    expect(result.status).toBe("cancelled");
  });

  it("does not call workflow services for an already terminal run", async () => {
    const cancelWorkflow = vi.fn();
    const confirmCancelled = vi.fn();

    const result = await cancelRunAndReconcile({
      requestCancellation: async () => ({
        runId: "run-1",
        status: "failed",
        alreadyTerminal: true,
      }),
      cancelWorkflow,
      confirmCancelled,
    });

    expect(cancelWorkflow).not.toHaveBeenCalled();
    expect(confirmCancelled).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("does not hide a database cancellation failure", async () => {
    await expect(
      cancelRunAndReconcile({
        requestCancellation: async () => {
          throw new Error("RUN_CANCEL_FAILED");
        },
        cancelWorkflow: vi.fn(),
        confirmCancelled: vi.fn(),
      }),
    ).rejects.toThrow("RUN_CANCEL_FAILED");
  });
});
