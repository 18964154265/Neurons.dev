import type { PreparedEngineerRun } from "@/lib/runs/worker-store";

export async function prepareRunStep(runId: string) {
  "use step";
  const { prepareEngineerRun } = await import("@/lib/runs/worker-store");
  return prepareEngineerRun(runId);
}

export async function runEngineerModelStep(run: PreparedEngineerRun) {
  "use step";
  const [{ resolveEngineerDefinition }, { runEngineerTurn }, { createOpenRouterLLMClient }, store] =
    await Promise.all([
      import("@/lib/agents/registry"),
      import("@/lib/agents/engineer-turn"),
      import("@/lib/llm/openrouter"),
      import("@/lib/runs/worker-store"),
    ]);

  let streamedText = "";
  let lastPersistedLength = 0;
  let result: Awaited<ReturnType<typeof runEngineerTurn>>;
  try {
    result = await runEngineerTurn(createOpenRouterLLMClient(), {
      agent: resolveEngineerDefinition(),
      conversation: [{ role: "user", content: run.prompt }],
      onEvent: async (event) => {
        if (event.type !== "text_delta") return;
        streamedText += event.text;
        if (streamedText.length - lastPersistedLength < 128) return;
        lastPersistedLength = streamedText.length;
        // The final write in completeRunStep is authoritative; these writes only power Realtime UI.
        await store.updateAssistantStream(run.assistantMessageId, streamedText);
      },
    });
  } catch (error) {
    const { classifyModelError } = await import("@/lib/llm/errors");
    throw new Error(classifyModelError(error));
  }
  await store.updateAssistantStream(run.assistantMessageId, result.text);
  return { text: result.text, toolCalls: result.toolCalls, usage: result.usage };
}

runEngineerModelStep.maxRetries = 0;

export async function completeRunStep(
  run: PreparedEngineerRun,
  output: Awaited<ReturnType<typeof runEngineerModelStep>>,
) {
  "use step";
  const { completeEngineerRun } = await import("@/lib/runs/worker-store");
  await completeEngineerRun(run, output);
}

export async function failRunStep(runId: string, failureCode: string) {
  "use step";
  const { failAgentRun } = await import("@/lib/runs/worker-store");
  await failAgentRun(runId, failureCode);
}
