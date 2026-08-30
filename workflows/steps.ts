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
    store,
  ] = await Promise.all([
    import("@/lib/agents/registry"),
    import("@/lib/agents/engineer-turn"),
    import("@/lib/llm/openrouter"),
    import("@/lib/runs/worker-store"),
  ]);

  let result: Awaited<ReturnType<typeof runEngineerTurn>> | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let streamedText = "";
    let lastPersistedLength = 0;
    let lastPersistedAt = Date.now();
    try {
      result = await runEngineerTurn(createOpenRouterLLMClient(), {
        agent: resolveEngineerDefinition(),
        conversation: [{ role: "user", content: run.prompt }],
        onEvent: async (event) => {
          if (event.type !== "text_delta") return;
          streamedText += event.text;
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
  await store.updateAssistantStream(run.assistantMessageId, result.text);
  return {
    text: result.text,
    toolCalls: result.toolCalls,
    usage: result.usage,
  };
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
