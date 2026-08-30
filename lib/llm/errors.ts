export type ModelFailureCode =
  | "MODEL_AUTH_FAILED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_TIMEOUT"
  | "MODEL_CONTEXT_EXCEEDED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_INVALID_REQUEST"
  | "MODEL_INVALID_TOOL_CALL"
  | "MODEL_STREAM_INTERRUPTED"
  | "MODEL_POLICY_BLOCKED";

type ProviderErrorShape = {
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  request_id?: unknown;
  requestID?: unknown;
  headers?: unknown;
  cause?: unknown;
};

export type ModelFailure = {
  code: ModelFailureCode;
  retryable: boolean;
  provider: {
    status: number | null;
    code: string | null;
    requestId: string | null;
    message: string;
  };
};

const MODEL_FAILURE_MARKER = "MODEL_FAILURE:";
const MAX_PROVIDER_FIELD_LENGTH = 240;

function bounded(value: unknown, maximum = MAX_PROVIDER_FIELD_LENGTH) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function safeProviderMessage(value: unknown) {
  const message = bounded(value) ?? "Provider request failed";
  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(
      /(["']?(?:authorization|api_?key|token)["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/([?&](?:api_?key|token|key)=)[^&\s]+/gi, "$1[REDACTED]");
}

function requestIdFromHeaders(headers: unknown) {
  if (!headers || typeof headers !== "object") return null;
  if (typeof Reflect.get(headers, "get") === "function") {
    const get = Reflect.get(headers, "get") as (name: string) => unknown;
    return bounded(get.call(headers, "x-request-id"), 120);
  }
  return bounded(
    Reflect.get(headers, "x-request-id") ??
      Reflect.get(headers, "x-openrouter-request-id"),
    120,
  );
}

export function classifyModelError(error: unknown): ModelFailureCode {
  const providerError = (error ?? {}) as ProviderErrorShape;
  const status =
    typeof providerError.status === "number" ? providerError.status : null;
  const code = String(providerError.code ?? "").toLowerCase();
  const name = String(providerError.name ?? "").toLowerCase();
  const message = String(providerError.message ?? "").toLowerCase();

  if (status === 401 || status === 403 || code.includes("auth"))
    return "MODEL_AUTH_FAILED";
  if (status === 429 || code.includes("rate_limit"))
    return "MODEL_RATE_LIMITED";
  if (status === 408 || name === "aborterror" || code.includes("timeout"))
    return "MODEL_TIMEOUT";
  if (code.includes("context") || message.includes("context length")) {
    return "MODEL_CONTEXT_EXCEEDED";
  }
  if (
    status === 451 ||
    code.includes("policy") ||
    code.includes("moderation")
  ) {
    return "MODEL_POLICY_BLOCKED";
  }
  if (status !== null && status >= 500) return "MODEL_UNAVAILABLE";
  if (code.includes("tool") || message.includes("tool call"))
    return "MODEL_INVALID_TOOL_CALL";
  if (status !== null && status >= 400) return "MODEL_INVALID_REQUEST";
  return "MODEL_STREAM_INTERRUPTED";
}

export function describeModelError(error: unknown): ModelFailure {
  const providerError = (error ?? {}) as ProviderErrorShape;
  const status =
    typeof providerError.status === "number" ? providerError.status : null;
  const code = classifyModelError(error);
  const providerCode = bounded(providerError.code, 120);
  const requestId =
    bounded(providerError.request_id ?? providerError.requestID, 120) ??
    requestIdFromHeaders(providerError.headers);

  return {
    code,
    retryable: [
      "MODEL_RATE_LIMITED",
      "MODEL_TIMEOUT",
      "MODEL_UNAVAILABLE",
      "MODEL_STREAM_INTERRUPTED",
    ].includes(code),
    provider: {
      status,
      code: providerCode,
      requestId,
      message: safeProviderMessage(providerError.message),
    },
  };
}

export function serializeModelFailure(failure: ModelFailure) {
  return `${MODEL_FAILURE_MARKER}${encodeURIComponent(JSON.stringify(failure))}`;
}

export function extractModelFailure(error: unknown): ModelFailure | null {
  const candidates: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "string") {
      candidates.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const message = Reflect.get(current, "message");
    if (typeof message === "string") candidates.push(message);
    current = Reflect.get(current, "cause");
  }

  for (const candidate of candidates) {
    const markerIndex = candidate.indexOf(MODEL_FAILURE_MARKER);
    if (markerIndex < 0) continue;
    const encoded = candidate
      .slice(markerIndex + MODEL_FAILURE_MARKER.length)
      .split(/\s/)[0];
    if (!encoded) continue;
    try {
      const parsed = JSON.parse(decodeURIComponent(encoded)) as ModelFailure;
      if (
        parsed?.code &&
        typeof parsed.retryable === "boolean" &&
        parsed.provider
      ) {
        return parsed;
      }
    } catch {
      // A workflow wrapper can truncate malformed diagnostics; fall back to the generic code.
    }
  }
  return null;
}
