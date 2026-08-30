import type {
  PreparedAgentRun,
  PreparedAgentTurn,
} from "@/lib/runs/worker-store";
import { shouldFlushAssistantStream } from "@/lib/runs/streaming";
import type { AgentKey } from "@/lib/agents/registry";

export async function prepareRunStep(runId: string) {
  "use step";
  const { prepareAgentRun } = await import("@/lib/runs/worker-store");
  try {
    return await prepareAgentRun(runId);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "RUN_PREPARATION_FAILED",
      "lib/runs/worker-store.prepareAgentRun",
    );
  }
}
prepareRunStep.maxRetries = 0;

export async function beginAgentTurnStep(
  run: PreparedAgentRun,
  agentKey: AgentKey,
  previousAgentKey: AgentKey | null,
) {
  "use step";
  const { beginAgentTurn } = await import("@/lib/runs/worker-store");
  try {
    return await beginAgentTurn(run, agentKey, previousAgentKey);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "AGENT_TURN_START_FAILED",
      "lib/runs/worker-store.beginAgentTurn",
    );
  }
}
beginAgentTurnStep.maxRetries = 0;

export async function runAgentModelStep(
  turn: PreparedAgentTurn,
  previousOutputs: Array<{ agentKey: AgentKey; text: string }>,
) {
  "use step";
  const [
    { resolveAgentDefinition, resolveAgentDefinitionForMode },
    { runEngineerTurn },
    { createOpenRouterLLMClient },
    delegation,
    { executeWorkspaceToolCall },
    store,
  ] = await Promise.all([
    import("@/lib/agents/registry"),
    import("@/lib/agents/engineer-turn"),
    import("@/lib/llm/openrouter"),
    import("@/lib/tools/agent-delegation"),
    import("@/lib/tools/workspace-files"),
    import("@/lib/runs/worker-store"),
  ]);

  const agent = resolveAgentDefinitionForMode(turn.agentKey, turn.mode);
  const client = createOpenRouterLLMClient();
  const handoffContext = previousOutputs.length
    ? `\n\n团队前序交接（只作为已完成工作的上下文）：\n${previousOutputs
        .map(
          (output) =>
            `[${resolveAgentDefinition(output.agentKey).displayName}]\n${output.text.slice(0, 8_000)}`,
        )
        .join("\n\n")}`
    : "";
  const conversation: import("@/lib/llm/types").LLMMessage[] = [
    { role: "user", content: `${turn.prompt}${handoffContext}` },
  ];
  const allToolCalls: import("@/lib/llm/types").LLMToolCall[] = [];
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let hasUsage = false;
  let completedText = "";
  const delegatedAgentKeys = new Set<AgentKey>();

  for (let toolTurn = 0; toolTurn < 8; toolTurn += 1) {
    let result: Awaited<ReturnType<typeof runEngineerTurn>> | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const turnTextParts: string[] = [];
      let turnTextLength = 0;
      let lastPersistedLength = completedText.length;
      let lastPersistedAt = Date.now();
      try {
        result = await runEngineerTurn(client, {
          agent,
          conversation,
          onEvent: async (event) => {
            if (event.type !== "text_delta") return;
            turnTextParts.push(event.text);
            turnTextLength += event.text.length;
            const currentLength = completedText.length + turnTextLength;
            const pendingCharacters = currentLength - lastPersistedLength;
            const elapsed = Date.now() - lastPersistedAt;
            if (
              !shouldFlushAssistantStream({
                pendingCharacters,
                elapsedMs: elapsed,
              })
            )
              return;
            const streamedText = `${completedText}${turnTextParts.join("")}`;
            lastPersistedLength = currentLength;
            lastPersistedAt = Date.now();
            await store.updateAssistantStream(
              turn.assistantMessageId,
              streamedText,
            );
          },
        });
        break;
      } catch (error) {
        const { extractLocatedError } = await import("@/lib/errors/located");
        if (extractLocatedError(error)) throw error;
        const { describeModelError, serializeModelFailure } =
          await import("@/lib/llm/errors");
        const failure = describeModelError(error);
        if (failure.retryable && attempt < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * 2 ** attempt),
          );
          continue;
        }
        throw new Error(serializeModelFailure(failure));
      }
    }

    if (!result) throw new Error("MODEL_RUN_RESULT_MISSING");
    completedText += result.text;
    allToolCalls.push(...result.toolCalls);
    if (result.usage) {
      hasUsage = true;
      totalUsage.promptTokens += result.usage.promptTokens;
      totalUsage.completionTokens += result.usage.completionTokens;
      totalUsage.totalTokens += result.usage.totalTokens;
    }

    if (result.toolCalls.length === 0) {
      await store.updateAssistantStream(turn.assistantMessageId, completedText);
      return {
        text: completedText,
        toolCalls: allToolCalls,
        usage: hasUsage ? totalUsage : null,
        delegatedAgentKeys: [...delegatedAgentKeys],
      };
    }

    conversation.push({
      role: "assistant",
      content: result.text || null,
      toolCalls: result.toolCalls,
    });
    for (const call of result.toolCalls) {
      const toolResult = delegation.isAgentDelegationTool(call.name)
        ? await delegation.executeAgentDelegationTool(turn, call)
        : await executeWorkspaceToolCall(turn, call);
      if (toolResult.delegatedAgentKey) {
        delegatedAgentKeys.add(toolResult.delegatedAgentKey);
      }
      conversation.push({
        role: "tool",
        content: toolResult.content,
        toolCallId: toolResult.toolCallId,
      });
    }
  }

  throw new Error("AGENT_TOOL_TURN_LIMIT_EXCEEDED");
}

runAgentModelStep.maxRetries = 0;

export async function completeAgentTurnStep(
  turn: PreparedAgentTurn,
  output: Awaited<ReturnType<typeof runAgentModelStep>>,
) {
  "use step";
  const { completeAgentTurn } = await import("@/lib/runs/worker-store");
  try {
    await completeAgentTurn(turn, output);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "AGENT_TURN_COMPLETION_FAILED",
      "lib/runs/worker-store.completeAgentTurn",
    );
  }
}
completeAgentTurnStep.maxRetries = 0;

export async function completeRunStep(run: PreparedAgentRun) {
  "use step";
  const { completeAgentRun } = await import("@/lib/runs/worker-store");
  try {
    await completeAgentRun(run);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "RUN_COMPLETION_PERSIST_FAILED",
      "lib/runs/worker-store.completeAgentRun",
    );
  }
}
completeRunStep.maxRetries = 0;

export async function failRunStep(
  runId: string,
  failureCode: string,
  failureDetail?: Record<string, unknown>,
) {
  "use step";
  const { failAgentRun } = await import("@/lib/runs/worker-store");
  try {
    await failAgentRun(runId, failureCode, failureDetail);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "RUN_FAILURE_PERSIST_FAILED",
      "lib/runs/worker-store.failAgentRun",
    );
  }
}
failRunStep.maxRetries = 0;
