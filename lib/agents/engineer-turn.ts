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

type ToolCallBuffer = {
  index: number;
  id: string;
  nameParts: string[];
  argumentParts: string[];
};

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

  const textParts: string[] = [];
  let usage: LLMUsage | null = null;
  const toolCallBuffers = new Map<number, ToolCallBuffer>();

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
      textParts.push(event.text);
      await input.onEvent?.(event);
    } else if (event.type === "tool_call_delta") {
      const buffer = toolCallBuffers.get(event.toolCall.index) ?? {
        index: event.toolCall.index,
        id: "",
        nameParts: [],
        argumentParts: [],
      };
      if (event.toolCall.id) buffer.id = event.toolCall.id;
      if (event.toolCall.name) buffer.nameParts.push(event.toolCall.name);
      if (event.toolCall.arguments) {
        buffer.argumentParts.push(event.toolCall.arguments);
      }
      toolCallBuffers.set(event.toolCall.index, buffer);
    } else if (event.type === "usage") {
      usage = event.usage;
    }
  }

  const completed: EngineerTurnEvent = {
    type: "completed",
    text: textParts.join(""),
    toolCalls: [...toolCallBuffers.values()]
      .map((buffer) => ({
        index: buffer.index,
        id: buffer.id,
        name: buffer.nameParts.join(""),
        arguments: buffer.argumentParts.join(""),
      }))
      .sort((left, right) => left.index - right.index),
    usage,
  };
  await input.onEvent?.(completed);
  return completed;
}
