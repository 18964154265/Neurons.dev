type RunAgent = {
  name: string;
  assigned: boolean;
  runId: string | null;
  status: string | null;
};

export function agentNamesForRun(agents: RunAgent[], runId: string | null) {
  if (!runId) return [];
  return agents
    .filter(
      (agent) =>
        agent.assigned && agent.runId === runId && agent.status === "active",
    )
    .map((agent) => agent.name);
}

export function workingAgentLabel(names: string[]) {
  return names.length ? `${names.join("、")} 正在工作` : "Agent 正在工作";
}
