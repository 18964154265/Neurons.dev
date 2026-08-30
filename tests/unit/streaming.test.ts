import { describe, expect, it } from "vitest";

import {
  STREAM_FLUSH_INTERVAL_MS,
  STREAM_FLUSH_MIN_CHARS,
  shouldFlushAssistantStream,
} from "@/lib/runs/streaming";

describe("assistant stream batching", () => {
  it("flushes once enough text has accumulated", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: STREAM_FLUSH_MIN_CHARS,
        elapsedMs: 0,
      }),
    ).toBe(true);
  });

  it("flushes slow streams without waiting for the character threshold", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: 1,
        elapsedMs: STREAM_FLUSH_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("batches very small, fast deltas", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: STREAM_FLUSH_MIN_CHARS - 1,
        elapsedMs: STREAM_FLUSH_INTERVAL_MS - 1,
      }),
    ).toBe(false);
  });
});
