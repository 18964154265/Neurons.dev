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

  it("assigns Mike to automatic Team Mode", () => {
    expect(
      resolveAgentKeysForRun({
        mode: "team",
        scheduleStrategy: "automatic",
        agentKeys: [],
      }),
    ).toEqual(["mike"]);
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
