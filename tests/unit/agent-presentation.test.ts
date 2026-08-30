import { describe, expect, it } from "vitest";

import { agentNamesForRun, workingAgentLabel } from "@/lib/agents/presentation";

const agents = [
  { name: "Alex", assigned: true, runId: "run-1", status: "active" },
  { name: "Mike", assigned: true, runId: "run-2", status: "completed" },
  { name: "Emma", assigned: false, runId: null, status: null },
];

describe("agent run presentation", () => {
  it("uses only agents assigned to the current run", () => {
    expect(agentNamesForRun(agents, "run-1")).toEqual(["Alex"]);
  });

  it("supports multiple real agent names", () => {
    expect(workingAgentLabel(["Mike", "Emma"])).toBe("Mike、Emma 正在工作");
  });

  it("uses a neutral label while assignments are loading", () => {
    expect(workingAgentLabel([])).toBe("Agent 正在工作");
  });
});
