import { describe, expect, it } from "vitest";

import { extractLocatedError, locatedError } from "@/lib/errors/located";

describe("located application errors", () => {
  it("preserves a stable code and trigger location through a runtime wrapper", () => {
    const inner = locatedError(
      new Error("could not determine data type of parameter $1"),
      "ASSISTANT_STREAM_PERSIST_FAILED",
      "lib/runs/worker-store.updateAssistantStream",
    );
    const wrapped = new Error(`Step failed: ${inner.message} after 0 retries`);

    expect(extractLocatedError(wrapped)).toEqual({
      code: "ASSISTANT_STREAM_PERSIST_FAILED",
      location: "lib/runs/worker-store.updateAssistantStream",
      message: "could not determine data type of parameter $1",
    });
  });

  it("redacts common credentials from internal diagnostics", () => {
    const error = locatedError(
      new Error("Bearer private-token and sk-private-value"),
      "INTERNAL_FAILURE",
      "module.operation",
    );

    expect(extractLocatedError(error)?.message).toBe(
      "Bearer [REDACTED] and [REDACTED]",
    );
  });
});
