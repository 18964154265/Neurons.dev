import "server-only";

import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions.mjs";
import { z } from "zod";

import type {
  LLMClient,
  LLMMessage,
  LLMStreamEvent,
  LLMStreamInput,
} from "@/lib/llm/types";
import { resolveServerAppOrigin } from "@/lib/urls/app-url";

const openRouterConfigurationSchema = z.object({
  apiKey: z.string().min(1),
  baseURL: z.url().default("https://openrouter.ai/api/v1"),
  defaultModel: z.string().min(1),
  appURL: z.url(),
});

export type OpenRouterConfiguration = z.infer<
  typeof openRouterConfigurationSchema
>;

type ChatCompletionStream = AsyncIterable<ChatCompletionChunk>;
type ChatCompletionsClient = {
  create(
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<ChatCompletionStream>;
};

const TEXT_DELTA_MIN_CHARS = 64;
const TEXT_DELTA_MAX_WAIT_MS = 80;
const TEXT_DELTA_BOUNDARY_MIN_CHARS = 32;

function shouldEmitTextDelta(
  textLength: number,
  latestPart: string,
  elapsedMs: number,
) {
  return (
    textLength >= TEXT_DELTA_MIN_CHARS ||
    elapsedMs >= TEXT_DELTA_MAX_WAIT_MS ||
    (textLength >= TEXT_DELTA_BOUNDARY_MIN_CHARS &&
      /[\n.!?。！？]\s*$/.test(latestPart))
  );
}

function toProviderMessage(message: LLMMessage): ChatCompletionMessageParam {
  if (message.role === "tool") {
    if (!message.toolCallId) {
      throw new Error("LLM_TOOL_MESSAGE_ID_REQUIRED");
    }
    return {
      role: "tool",
      content: message.content ?? "",
      tool_call_id: message.toolCallId,
    };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content ?? "" };
}

function toProviderTools(
  input: LLMStreamInput,
): ChatCompletionTool[] | undefined {
  return input.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function readOpenRouterConfiguration(
  environment: Record<string, string | undefined> = process.env,
): OpenRouterConfiguration {
  return openRouterConfigurationSchema.parse({
    apiKey: environment.OPENROUTER_API_KEY,
    baseURL: environment.OPENROUTER_BASE_URL,
    defaultModel:
      environment.OPENROUTER_DEFAULT_MODEL ?? environment.OPENROUTER_MODEL,
    appURL: resolveServerAppOrigin(environment),
  });
}

export class OpenRouterLLMClient implements LLMClient {
  private readonly completions: ChatCompletionsClient;

  constructor(
    private readonly configuration: OpenRouterConfiguration,
    completions?: ChatCompletionsClient,
  ) {
    const validConfiguration =
      openRouterConfigurationSchema.parse(configuration);
    this.configuration = validConfiguration;
    this.completions =
      completions ??
      (new OpenAI({
        apiKey: validConfiguration.apiKey,
        baseURL: validConfiguration.baseURL,
        defaultHeaders: {
          "HTTP-Referer": validConfiguration.appURL,
          "X-OpenRouter-Title": "Neurons",
        },
      }).chat.completions as unknown as ChatCompletionsClient);
  }

  async *stream(
    input: LLMStreamInput,
    signal?: AbortSignal,
  ): AsyncIterable<LLMStreamEvent> {
    const providerStream = await this.completions.create(
      {
        model: input.model ?? this.configuration.defaultModel,
        messages: input.messages.map(toProviderMessage),
        tools: toProviderTools(input),
        tool_choice: input.tools?.length ? "auto" : undefined,
        temperature: input.temperature,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );

    let finishReason: string | null = null;
    let textParts: string[] = [];
    let textLength = 0;
    let textBufferedAt = 0;
    const drainText = () => {
      if (!textLength) return null;
      const text = textParts.join("");
      textParts = [];
      textLength = 0;
      textBufferedAt = 0;
      return text;
    };
    for await (const chunk of providerStream) {
      signal?.throwIfAborted();
      const choice = chunk.choices[0];
      const text = choice?.delta.content;
      if (text) {
        if (!textBufferedAt) textBufferedAt = Date.now();
        textParts.push(text);
        textLength += text.length;
        if (
          shouldEmitTextDelta(textLength, text, Date.now() - textBufferedAt)
        ) {
          yield { type: "text_delta", text: drainText()! };
        }
      }
      for (const toolCall of choice?.delta.tool_calls ?? []) {
        const pendingText = drainText();
        if (pendingText) yield { type: "text_delta", text: pendingText };
        yield {
          type: "tool_call_delta",
          toolCall: {
            index: toolCall.index,
            id: toolCall.id ?? "",
            name: toolCall.function?.name ?? "",
            arguments: toolCall.function?.arguments ?? "",
          },
        };
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        const pendingText = drainText();
        if (pendingText) yield { type: "text_delta", text: pendingText };
        yield {
          type: "usage",
          usage: {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
    }
    const pendingText = drainText();
    if (pendingText) yield { type: "text_delta", text: pendingText };
    yield { type: "completed", finishReason };
  }
}

export function createOpenRouterLLMClient() {
  return new OpenRouterLLMClient(readOpenRouterConfiguration());
}
