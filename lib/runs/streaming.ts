export const STREAM_FLUSH_MIN_CHARS = 48;
export const STREAM_FLUSH_INTERVAL_MS = 150;

export function shouldFlushAssistantStream({
  pendingCharacters,
  elapsedMs,
}: {
  pendingCharacters: number;
  elapsedMs: number;
}) {
  return (
    pendingCharacters >= STREAM_FLUSH_MIN_CHARS ||
    elapsedMs >= STREAM_FLUSH_INTERVAL_MS
  );
}
