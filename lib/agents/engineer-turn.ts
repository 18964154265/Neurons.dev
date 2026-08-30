import type {
  LLMClient,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMUsage,
} from "@/lib/llm/types";
import { locatedError } from "@/lib/errors/located";

export type EngineerDefinition = {
  key: string;
  version: number;
  instructions: string;
  model?: string;
  tools: LLMTool[];
};

export type EngineerTurnEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_progress"; toolCall: LLMToolCall }
  | {
      type: "completed";
      text: string;
      toolCalls: LLMToolCall[];
      usage: LLMUsage | null;
    };

export type EngineerTurnInput = {
  agent: EngineerDefinition;
  conversation: LLMMessage[];
  signal?: AbortSignal;
  onEvent?: (event: EngineerTurnEvent) => void | Promise<void>;
};

function mergeToolCall(
  current: LLMToolCall | undefined,
  delta: LLMToolCall,
): LLMToolCall {
  return {
    index: delta.index,
    id: delta.id || current?.id || "",
    name: `${current?.name ?? ""}${delta.name}`,
    arguments: `${current?.arguments ?? ""}${delta.arguments}`,
  };
}

export async function runEngineerTurn(
  client: LLMClient,
  input: EngineerTurnInput,
) {
  if (
    !input.agent.key ||
    input.agent.version < 1 ||
    !input.agent.instructions.trim()
  ) {
    throw locatedError(
      new Error("Agent key, version, and instructions are required"),
      "ENGINEER_DEFINITION_INVALID",
      "lib/agents/engineer-turn.runEngineerTurn",
    );
  }

  let text = "";
  let usage: LLMUsage | null = null;
  const toolCalls = new Map<number, LLMToolCall>();

  for await (const event of client.stream(
    {
      model: input.agent.model,
      messages: [
        { role: "developer", content: input.agent.instructions },
        ...input.conversation,
      ],
      tools: input.agent.tools,
    },
    input.signal,
  )) {
    input.signal?.throwIfAborted();
    if (event.type === "text_delta") {
      text += event.text;
      await input.onEvent?.(event);
    } else if (event.type === "tool_call_delta") {
      const merged = mergeToolCall(
        toolCalls.get(event.toolCall.index),
        event.toolCall,
      );
      toolCalls.set(event.toolCall.index, merged);
      await input.onEvent?.({ type: "tool_call_progress", toolCall: merged });
    } else if (event.type === "usage") {
      usage = event.usage;
    }
  }

  const completed: EngineerTurnEvent = {
    type: "completed",
    text,
    toolCalls: [...toolCalls.values()].sort(
      (left, right) => left.index - right.index,
    ),
    usage,
  };
  await input.onEvent?.(completed);
  return completed;
}
