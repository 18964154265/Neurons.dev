import { describe, expect, it } from "vitest";

import { extractRunFailureCode, runFailureMessage } from "@/lib/runs/failure";

describe("run failure presentation", () => {
  it("extracts a message from a serialized workflow error", () => {
    expect(extractRunFailureCode({ message: "PREPARE_RUN_FAILED" })).toBe(
      "PREPARE_RUN_FAILED",
    );
  });

  it("bounds persisted failure details", () => {
    expect(extractRunFailureCode({ message: "x".repeat(200) })).toHaveLength(
      120,
    );
  });

  it("falls back safely for an unknown thrown value", () => {
    expect(extractRunFailureCode(null)).toBe("RUN_FAILED");
  });

  it("provides actionable copy for an interrupted model stream", () => {
    expect(runFailureMessage("MODEL_STREAM_INTERRUPTED")).toContain("重新发送");
  });

  it("directs invalid model requests to the persisted trace", () => {
    expect(runFailureMessage("MODEL_INVALID_REQUEST")).toContain("Trace");
  });
});
