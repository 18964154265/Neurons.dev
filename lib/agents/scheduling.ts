type AgentSelection = {
  mode: "engineer" | "team";
  scheduleStrategy: "automatic" | "user_selected";
  agentKeys: string[];
  message?: string;
};

/** Low-risk requests should bypass the Team Lead's planning turn. */
export function classifyTaskComplexity(message: string | undefined) {
  const text = message?.trim().toLowerCase() ?? "";
  if (!text) return "normal" as const;
  const complexSignals = /架构|数据库|迁移|权限|认证|部署|发布|安全|schema|database|migration|deploy|publish|auth|security/;
  const simpleSignals = /样式|颜色|字体|按钮|文案|复制|折叠|滚动|修复|调整|修改|添加|实现|style|color|font|button|copy|fix|change|add|update/;
  if (complexSignals.test(text)) return "complex" as const;
  if (simpleSignals.test(text) && text.length <= 240) return "simple" as const;
  return "normal" as const;
}

export function resolveAgentKeysForRun(selection: AgentSelection) {
  if (
    selection.scheduleStrategy === "user_selected" ||
    selection.agentKeys.length > 0
  ) {
    return [...selection.agentKeys];
  }
  if (selection.mode === "engineer") return ["alex"];
  // Automatic, low-risk tasks go straight to Alex. Mike remains the
  // coordinator for ambiguous or cross-domain work where a task graph helps.
  return [classifyTaskComplexity(selection.message) === "simple" ? "alex" : "mike"];
}
