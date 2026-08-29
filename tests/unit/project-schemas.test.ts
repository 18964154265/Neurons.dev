import { describe, expect, it } from "vitest";

import { sendMessageSchema } from "@/lib/chat/schemas";
import { createProjectSchema, defaultProjectName } from "@/lib/projects/schemas";

describe("project request schemas", () => {
  it("applies safe defaults to an initial request", () => {
    expect(createProjectSchema.parse({ initialMessage: "Build a dashboard" })).toEqual({
      initialMessage: "Build a dashboard",
      mode: "engineer",
      scheduleStrategy: "automatic",
      agentKeys: [],
    });
  });

  it("requires an agent for user-selected scheduling", () => {
    expect(() =>
      sendMessageSchema.parse({
        message: "Continue",
        mode: "team",
        scheduleStrategy: "user_selected",
        agentKeys: [],
      }),
    ).toThrow();
  });

  it("creates a bounded project name from the first message", () => {
    expect(defaultProjectName("  Create   a portfolio site  ")).toBe("Create a portfolio site");
    expect(defaultProjectName("x".repeat(80))).toHaveLength(40);
  });
});
