export type LocatedErrorDetail = {
  code: string;
  location: string;
  message: string;
};

const LOCATED_ERROR_MARKER = "LOCATED_ERROR:";

function safeErrorMessage(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unexpected internal error";
  return raw
    .replace(/\s+/g, " ")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 240);
}

export function locatedError(error: unknown, code: string, location: string) {
  const detail: LocatedErrorDetail = {
    code: code.slice(0, 80),
    location: location.slice(0, 160),
    message: safeErrorMessage(error),
  };
  return new Error(
    `${LOCATED_ERROR_MARKER}${encodeURIComponent(JSON.stringify(detail))}`,
    { cause: error },
  );
}

export function extractLocatedError(error: unknown): LocatedErrorDetail | null {
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
    const markerIndex = candidate.indexOf(LOCATED_ERROR_MARKER);
    if (markerIndex < 0) continue;
    const encoded = candidate
      .slice(markerIndex + LOCATED_ERROR_MARKER.length)
      .split(/\s/)[0];
    if (!encoded) continue;
    try {
      const parsed = JSON.parse(
        decodeURIComponent(encoded),
      ) as LocatedErrorDetail;
      if (parsed?.code && parsed.location && parsed.message) return parsed;
    } catch {
      // A runtime wrapper can truncate malformed diagnostics; use the generic fallback.
    }
  }
  return null;
}
