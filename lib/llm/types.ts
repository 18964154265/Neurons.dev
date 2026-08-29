export type LLMMessage = {
  role: "developer" | "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
};

export type LLMTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMToolCall = {
  index: number;
  id: string;
  name: string;
  arguments: string;
};

export type LLMUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LLMStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; toolCall: LLMToolCall }
  | { type: "usage"; usage: LLMUsage }
  | { type: "completed"; finishReason: string | null };

export type LLMStreamInput = {
  model?: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  temperature?: number;
};

export interface LLMClient {
  stream(input: LLMStreamInput, signal?: AbortSignal): AsyncIterable<LLMStreamEvent>;
}
