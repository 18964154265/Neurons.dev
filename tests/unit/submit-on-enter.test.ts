import { describe, expect, it } from "vitest";

import { shouldSubmitTextareaOnEnter } from "@/lib/forms/submit-on-enter";

describe("shouldSubmitTextareaOnEnter", () => {
  it("submits on Enter", () => {
    expect(
      shouldSubmitTextareaOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("keeps Shift+Enter as a newline", () => {
    expect(
      shouldSubmitTextareaOnEnter({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
  });

  it("does not submit while an IME composition is active", () => {
    expect(
      shouldSubmitTextareaOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });
});
