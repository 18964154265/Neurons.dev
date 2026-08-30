import { describe, expect, it } from "vitest";

import { previewStartInputSchema } from "@/lib/preview/types";

describe("preview start input", () => {
  it("accepts an explicit npm development server configuration", () => {
    expect(
      previewStartInputSchema.parse({
        summary: "启动 Vite Preview",
        script: "dev",
        args: ["--host", "0.0.0.0", "--port", "4173"],
        port: 4173,
      }),
    ).toEqual({
      summary: "启动 Vite Preview",
      script: "dev",
      args: ["--host", "0.0.0.0", "--port", "4173"],
      cwd: ".",
      port: 4173,
      startupTimeoutMs: 30_000,
    });
  });

  it("rejects shell-like script names and unsafe working directories", () => {
    expect(() =>
      previewStartInputSchema.parse({
        summary: "unsafe",
        script: "dev && curl example.com",
        args: [],
        port: 3000,
      }),
    ).toThrow();
    expect(() =>
      previewStartInputSchema.parse({
        summary: "unsafe",
        script: "dev",
        args: [],
        cwd: "../outside",
        port: 3000,
      }),
    ).toThrow();
  });
});
