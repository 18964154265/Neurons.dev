import { describe, expect, it } from "vitest";

import {
  agentDefinitions,
  delegationTargetsByAgent,
  defaultScheduleRules,
  ENGINEER_AGENT_KEY,
  resolveAgentDefinitionForMode,
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
    expect(
      resolveAgentDefinitionForMode("alex", "engineer").tools.map(
        (tool) => tool.name,
      ),
    ).toEqual([
      "workspace_list_files",
      "workspace_read_file",
      "coding",
      "terminal_run",
      "preview_start",
    ]);
    expect(
      resolveAgentDefinitionForMode("alex", "engineer").instructions,
    ).not.toContain("delegate_to_david");
  });

  it("preserves confirmed scheduling order and safe tool separation", () => {
    expect(defaultScheduleRules.complex_feature).toEqual([
      ["emma", "bob"],
      ["alex"],
      ["david"],
    ]);
    for (const definition of agentDefinitions) {
      expect(definition.toolLabels.length).toBeGreaterThan(0);
      expect(definition.instructions).toContain("不得声称已修改文件");
      expect(definition.instructions).toContain(
        "用户指定的 Agent 和任务范围优先于默认调度",
      );
    }
    expect(resolveEngineerDefinition().tools.map((tool) => tool.name)).toEqual([
      "workspace_list_files",
      "workspace_read_file",
      "coding",
      "terminal_run",
      "preview_start",
      "delegate_to_david",
    ]);
    expect(resolveEngineerDefinition().instructions).toContain(
      "必须显式调用 coding 工具",
    );
    expect(resolveEngineerDefinition().instructions).toContain(
      "必须调用 preview_start 启动开发服务器",
    );
    expect(delegationTargetsByAgent).toEqual({
      mike: ["emma", "bob", "alex", "david"],
      emma: ["bob", "alex"],
      bob: ["alex"],
      alex: ["david"],
      david: ["alex"],
    });
    for (const definition of agentDefinitions) {
      expect(
        definition.tools
          .filter((tool) => tool.name.startsWith("delegate_to_"))
          .map((tool) => tool.name.slice("delegate_to_".length)),
      ).toEqual(delegationTargetsByAgent[definition.key]);
    }
  });
});
