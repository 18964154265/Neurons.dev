import { describe, expect, it } from "vitest";

import {
  agentDefinitions,
  defaultScheduleRules,
  ENGINEER_AGENT_KEY,
  resolveEngineerDefinition,
  TEAM_LEAD_AGENT_KEY,
  USER_SELECTED_SCHEDULE_IS_STRICT,
} from "@/lib/agents/registry";

describe("agent registry", () => {
  it("defines exactly the five confirmed reusable agents", () => {
    expect(agentDefinitions.map((agent) => agent.key)).toEqual([
      "mike",
      "emma",
      "bob",
      "alex",
      "david",
    ]);
    expect(new Set(agentDefinitions.map((agent) => agent.key)).size).toBe(5);
  });

  it("uses Alex exclusively for Engineer Mode and Mike for Team Mode leadership", () => {
    expect(ENGINEER_AGENT_KEY).toBe("alex");
    expect(TEAM_LEAD_AGENT_KEY).toBe("mike");
    expect(resolveEngineerDefinition().key).toBe("alex");
    expect(USER_SELECTED_SCHEDULE_IS_STRICT).toBe(true);
  });

  it("preserves confirmed scheduling order and safe tool separation", () => {
    expect(defaultScheduleRules.complex_feature).toEqual([
      ["emma", "bob"],
      ["alex"],
      ["david"],
    ]);
    for (const definition of agentDefinitions) {
      expect(definition.toolLabels.length).toBeGreaterThan(0);
      expect(definition.tools).toEqual([]);
      expect(definition.instructions).toContain("不得声称已修改文件");
      expect(definition.instructions).toContain(
        "用户指定的 Agent 和任务范围优先于默认调度",
      );
    }
  });
});
