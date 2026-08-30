import type { ChatCompletionChunk } from "openai/resources/chat/completions.mjs";
import { describe, expect, it, vi } from "vitest";

import { runEngineerTurn } from "@/lib/agents/engineer-turn";
import {
  classifyModelError,
  describeModelError,
  extractModelFailure,
  serializeModelFailure,
} from "@/lib/llm/errors";
import {
  OpenRouterLLMClient,
  readOpenRouterConfiguration,
} from "@/lib/llm/openrouter";

async function* chunks(values: ChatCompletionChunk[]) {
  yield* values;
}

function chunk(value: Partial<ChatCompletionChunk>): ChatCompletionChunk {
  return {
    id: "completion-1",
    created: 1,
    model: "provider/model",
    object: "chat.completion.chunk",
    choices: [],
    ...value,
  };
}

describe("OpenRouterLLMClient", () => {
  it("uses configured model and normalizes streamed text, tool calls, and usage", async () => {
    const create = vi.fn().mockResolvedValue(
      chunks([
        chunk({
          choices: [
            {
              index: 0,
              finish_reason: null,
              delta: {
                content: "Working",
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "write_", arguments: '{"path":' },
                  },
                ],
              },
            },
          ],
        }),
        chunk({
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { name: "file", arguments: '"a.ts"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 },
        }),
      ]),
    );
    const client = new OpenRouterLLMClient(
      {
        apiKey: "test-key",
        baseURL: "https://openrouter.ai/api/v1",
        defaultModel: "provider/model",
        appURL: "http://localhost:3000",
      },
      { create },
    );

    const events = [];
    for await (const event of client.stream({
      messages: [{ role: "user", content: "Build" }],
    })) {
      events.push(event);
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "provider/model", stream: true }),
      expect.any(Object),
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Working" },
      {
        type: "tool_call_delta",
        toolCall: {
          index: 0,
          id: "call-1",
          name: "write_",
          arguments: '{"path":',
        },
      },
      {
        type: "tool_call_delta",
        toolCall: { index: 0, id: "", name: "file", arguments: '"a.ts"}' },
      },
      {
        type: "usage",
        usage: { promptTokens: 7, completionTokens: 4, totalTokens: 11 },
      },
      { type: "completed", finishReason: "tool_calls" },
    ]);
  });

  it("requires the OpenRouter key and model without reading unrelated secrets", () => {
    expect(() => readOpenRouterConfiguration({})).toThrow();
    expect(
      readOpenRouterConfiguration({
        OPENROUTER_API_KEY: "key",
        OPENROUTER_DEFAULT_MODEL: "provider/model",
      }),
    ).toMatchObject({ defaultModel: "provider/model" });
  });

  it("coalesces tiny provider text chunks before emitting model events", async () => {
    const create = vi.fn().mockResolvedValue(
      chunks([
        chunk({
          choices: [
            { index: 0, finish_reason: null, delta: { content: "Hel" } },
          ],
        }),
        chunk({
          choices: [
            { index: 0, finish_reason: null, delta: { content: "lo " } },
          ],
        }),
        chunk({
          choices: [
            { index: 0, finish_reason: "stop", delta: { content: "world" } },
          ],
        }),
      ]),
    );
    const client = new OpenRouterLLMClient(
      {
        apiKey: "test-key",
        baseURL: "https://openrouter.ai/api/v1",
        defaultModel: "provider/model",
        appURL: "http://localhost:3000",
      },
      { create },
    );

    const events = [];
    for await (const event of client.stream({
      messages: [{ role: "user", content: "Say hello" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello world" },
      { type: "completed", finishReason: "stop" },
    ]);
  });

  it("accepts the real environment model alias", () => {
    expect(
      readOpenRouterConfiguration({
        OPENROUTER_API_KEY: "key",
        OPENROUTER_MODEL: "provider/aliased-model",
      }),
    ).toMatchObject({ defaultModel: "provider/aliased-model" });
  });
});

describe("runEngineerTurn", () => {
  it("assembles fragmented tool calls without hardcoding an agent", async () => {
    const client = {
      async *stream() {
        yield { type: "text_delta" as const, text: "Done" };
        yield {
          type: "tool_call_delta" as const,
          toolCall: {
            index: 0,
            id: "call-1",
            name: "write_",
            arguments: '{"path":',
          },
        };
        yield {
          type: "tool_call_delta" as const,
          toolCall: { index: 0, id: "", name: "file", arguments: '"a.ts"}' },
        };
        yield {
          type: "usage" as const,
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        };
        yield { type: "completed" as const, finishReason: "tool_calls" };
      },
    };

    const result = await runEngineerTurn(client, {
      agent: {
        key: "configured-later",
        version: 1,
        instructions: "Build safely.",
        tools: [],
      },
      conversation: [{ role: "user", content: "Create a file" }],
    });

    expect(result).toEqual({
      type: "completed",
      text: "Done",
      toolCalls: [
        {
          index: 0,
          id: "call-1",
          name: "write_file",
          arguments: '{"path":"a.ts"}',
        },
      ],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });
});

describe("classifyModelError", () => {
  it.each([
    [{ status: 401 }, "MODEL_AUTH_FAILED"],
    [{ status: 429 }, "MODEL_RATE_LIMITED"],
    [{ name: "AbortError" }, "MODEL_TIMEOUT"],
    [{ code: "context_length_exceeded" }, "MODEL_CONTEXT_EXCEEDED"],
    [{ status: 503 }, "MODEL_UNAVAILABLE"],
    [{ status: 400 }, "MODEL_INVALID_REQUEST"],
    [{ code: "invalid_tool_arguments" }, "MODEL_INVALID_TOOL_CALL"],
  ] as const)("normalizes %o as %s", (error, expected) => {
    expect(classifyModelError(error)).toBe(expected);
  });

  it("keeps bounded provider diagnostics and redacts credentials", () => {
    const failure = describeModelError({
      status: 503,
      code: "provider_unavailable",
      request_id: "request-123",
      message:
        'Bearer secret-value failed with sk-sensitive-token api_key="another-secret"',
    });

    expect(failure).toEqual({
      code: "MODEL_UNAVAILABLE",
      retryable: true,
      provider: {
        status: 503,
        code: "provider_unavailable",
        requestId: "request-123",
        message:
          'Bearer [REDACTED] failed with [REDACTED] api_key="[REDACTED]"',
      },
    });
  });

  it("recovers serialized diagnostics from a workflow wrapper", () => {
    const failure = describeModelError({
      status: 429,
      message: "Rate limited",
    });
    const wrapped = new Error(
      `Step failed: ${serializeModelFailure(failure)} after retries`,
    );

    expect(extractModelFailure(wrapped)).toEqual(failure);
  });
});
