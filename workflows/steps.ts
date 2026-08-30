import type { PreparedEngineerRun } from "@/lib/runs/worker-store";
import { shouldFlushAssistantStream } from "@/lib/runs/streaming";

export async function prepareRunStep(runId: string) {
  "use step";
  const { prepareEngineerRun } = await import("@/lib/runs/worker-store");
  try {
    return await prepareEngineerRun(runId);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "RUN_PREPARATION_FAILED",
      "lib/runs/worker-store.prepareEngineerRun",
    );
  }
}

export async function runEngineerModelStep(run: PreparedEngineerRun) {
  "use step";
  const [
    { resolveEngineerDefinition },
    { runEngineerTurn },
    { createOpenRouterLLMClient },
    { executeWorkspaceToolCall },
    store,
  ] = await Promise.all([
    import("@/lib/agents/registry"),
    import("@/lib/agents/engineer-turn"),
    import("@/lib/llm/openrouter"),
    import("@/lib/tools/workspace-files"),
    import("@/lib/runs/worker-store"),
  ]);

  const agent = resolveEngineerDefinition();
  const client = createOpenRouterLLMClient();
  const conversation: import("@/lib/llm/types").LLMMessage[] = [
    { role: "user", content: run.prompt },
  ];
  const allToolCalls: import("@/lib/llm/types").LLMToolCall[] = [];
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let hasUsage = false;
  let completedText = "";

  for (let turn = 0; turn < 8; turn += 1) {
    let result: Awaited<ReturnType<typeof runEngineerTurn>> | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let turnText = "";
      let lastPersistedLength = completedText.length;
      let lastPersistedAt = Date.now();
      try {
        result = await runEngineerTurn(client, {
          agent,
          conversation,
          onEvent: async (event) => {
            if (event.type !== "text_delta") return;
            turnText += event.text;
            const streamedText = `${completedText}${turnText}`;
            const pendingCharacters = streamedText.length - lastPersistedLength;
            const elapsed = Date.now() - lastPersistedAt;
            if (
              !shouldFlushAssistantStream({
                pendingCharacters,
                elapsedMs: elapsed,
              })
            )
              return;
            lastPersistedLength = streamedText.length;
            lastPersistedAt = Date.now();
            // The final write in completeRunStep is authoritative; these writes only power Realtime UI.
            await store.updateAssistantStream(
              run.assistantMessageId,
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
      await store.updateAssistantStream(run.assistantMessageId, completedText);
      return {
        text: completedText,
        toolCalls: allToolCalls,
        usage: hasUsage ? totalUsage : null,
      };
    }

    conversation.push({
      role: "assistant",
      content: result.text || null,
      toolCalls: result.toolCalls,
    });
    for (const call of result.toolCalls) {
      const toolResult = await executeWorkspaceToolCall(run, call);
      conversation.push({
        role: "tool",
        content: toolResult.content,
        toolCallId: toolResult.toolCallId,
      });
    }
  }

  throw new Error("AGENT_TOOL_TURN_LIMIT_EXCEEDED");
}

// Provider retries are handled above so deterministic failures are never replayed by Workflow.
runEngineerModelStep.maxRetries = 0;

export async function completeRunStep(
  run: PreparedEngineerRun,
  output: Awaited<ReturnType<typeof runEngineerModelStep>>,
) {
  "use step";
  const { completeEngineerRun } = await import("@/lib/runs/worker-store");
  try {
    await completeEngineerRun(run, output);
  } catch (error) {
    const { locatedError } = await import("@/lib/errors/located");
    throw locatedError(
      error,
      "RUN_COMPLETION_PERSIST_FAILED",
      "lib/runs/worker-store.completeEngineerRun",
    );
  }
}

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
