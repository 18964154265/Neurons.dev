export const STREAM_FLUSH_MIN_CHARS = 160;
export const STREAM_FLUSH_MIN_INTERVAL_MS = 250;
export const STREAM_FLUSH_MAX_INTERVAL_MS = 400;

export function shouldFlushAssistantStream({
  pendingCharacters,
  elapsedMs,
}: {
  pendingCharacters: number;
  elapsedMs: number;
}) {
  if (pendingCharacters <= 0 || elapsedMs < STREAM_FLUSH_MIN_INTERVAL_MS) {
    return false;
  }
  return (
    pendingCharacters >= STREAM_FLUSH_MIN_CHARS ||
    elapsedMs >= STREAM_FLUSH_MAX_INTERVAL_MS
  );
}
