export type ModelFailureCode =
  | "MODEL_AUTH_FAILED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_TIMEOUT"
  | "MODEL_CONTEXT_EXCEEDED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_INVALID_TOOL_CALL"
  | "MODEL_STREAM_INTERRUPTED"
  | "MODEL_POLICY_BLOCKED";

type ProviderErrorShape = {
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
};

export function classifyModelError(error: unknown): ModelFailureCode {
  const providerError = (error ?? {}) as ProviderErrorShape;
  const status = typeof providerError.status === "number" ? providerError.status : null;
  const code = String(providerError.code ?? "").toLowerCase();
  const name = String(providerError.name ?? "").toLowerCase();
  const message = String(providerError.message ?? "").toLowerCase();

  if (status === 401 || status === 403 || code.includes("auth")) return "MODEL_AUTH_FAILED";
  if (status === 429 || code.includes("rate_limit")) return "MODEL_RATE_LIMITED";
  if (status === 408 || name === "aborterror" || code.includes("timeout")) return "MODEL_TIMEOUT";
  if (code.includes("context") || message.includes("context length")) {
    return "MODEL_CONTEXT_EXCEEDED";
  }
  if (status === 451 || code.includes("policy") || code.includes("moderation")) {
    return "MODEL_POLICY_BLOCKED";
  }
  if (status !== null && status >= 500) return "MODEL_UNAVAILABLE";
  if (code.includes("tool") || message.includes("tool call")) return "MODEL_INVALID_TOOL_CALL";
  return "MODEL_STREAM_INTERRUPTED";
}
