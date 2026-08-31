import { describe, expect, it } from "vitest";

import { resolveAgentKeysForRun } from "@/lib/agents/scheduling";

describe("default agent scheduling", () => {
  it("assigns Alex to automatic Engineer Mode", () => {
    expect(
      resolveAgentKeysForRun({
        mode: "engineer",
        scheduleStrategy: "automatic",
        agentKeys: [],
      }),
    ).toEqual(["alex"]);
  });

  it("assigns Mike to automatic Team Mode for normal work", () => {
    expect(
      resolveAgentKeysForRun({
        mode: "team",
        scheduleStrategy: "automatic",
        agentKeys: [],
      }),
    ).toEqual(["mike"]);
  });

  it("routes simple low-risk Team Mode work directly to Alex", () => {
    expect(
      resolveAgentKeysForRun({
        mode: "team",
        scheduleStrategy: "automatic",
        agentKeys: [],
        message: "调整按钮颜色和字体",
      }),
    ).toEqual(["alex"]);
  });

  it("preserves explicit user selection", () => {
    expect(
      resolveAgentKeysForRun({
        mode: "team",
        scheduleStrategy: "user_selected",
        agentKeys: ["emma", "bob"],
      }),
    ).toEqual(["emma", "bob"]);
  });
});
