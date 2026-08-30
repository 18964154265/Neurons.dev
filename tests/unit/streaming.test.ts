import { describe, expect, it } from "vitest";

import {
  STREAM_FLUSH_MAX_INTERVAL_MS,
  STREAM_FLUSH_MIN_INTERVAL_MS,
  STREAM_FLUSH_MIN_CHARS,
  shouldFlushAssistantStream,
} from "@/lib/runs/streaming";

describe("assistant stream batching", () => {
  it("flushes once enough text has accumulated", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: STREAM_FLUSH_MIN_CHARS,
        elapsedMs: STREAM_FLUSH_MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("flushes slow streams without waiting for the character threshold", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: 1,
        elapsedMs: STREAM_FLUSH_MAX_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("batches very small, fast deltas", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: STREAM_FLUSH_MIN_CHARS,
        elapsedMs: STREAM_FLUSH_MIN_INTERVAL_MS - 1,
      }),
    ).toBe(false);
  });

  it("does not flush a small burst before the maximum interval", () => {
    expect(
      shouldFlushAssistantStream({
        pendingCharacters: STREAM_FLUSH_MIN_CHARS - 1,
        elapsedMs: STREAM_FLUSH_MAX_INTERVAL_MS - 1,
      }),
    ).toBe(false);
  });
});
