import { describe, expect, it } from "vitest";

import {
  authCredentialsSchema,
  authErrorMessage,
  emailSchema,
  passwordSchema,
} from "@/lib/auth/credentials";

describe("auth credential validation", () => {
  it("normalizes a valid email and accepts a bounded password", () => {
    expect(
      authCredentialsSchema.parse({
        email: "  user@example.com ",
        password: "correct horse battery staple",
      }),
    ).toEqual({
      email: "user@example.com",
      password: "correct horse battery staple",
    });
  });

  it("rejects invalid emails and short or oversized passwords", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
  });

  it("maps common provider errors without exposing raw details", () => {
    expect(authErrorMessage("Invalid login credentials")).toBe(
      "邮箱或密码错误。",
    );
    expect(authErrorMessage("Email not confirmed")).toContain("确认邮件");
    expect(authErrorMessage("internal provider detail")).toBe(
      "认证请求失败，请稍后重试。",
    );
  });
});
