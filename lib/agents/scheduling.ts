type AgentSelection = {
  mode: "engineer" | "team";
  scheduleStrategy: "automatic" | "user_selected";
  agentKeys: string[];
};

export function resolveAgentKeysForRun(selection: AgentSelection) {
  if (
    selection.scheduleStrategy === "user_selected" ||
    selection.agentKeys.length > 0
  ) {
    return [...selection.agentKeys];
  }
  return [selection.mode === "engineer" ? "alex" : "mike"];
}
