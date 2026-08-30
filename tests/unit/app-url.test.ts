import { describe, expect, it } from "vitest";

import { createAppUrl, resolveServerAppOrigin } from "@/lib/urls/app-url";

describe("app URL resolution", () => {
  it("prefers the explicit canonical application origin", () => {
    expect(
      resolveServerAppOrigin({
        APP_URL: "https://neurons.example.com",
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://neurons.example.com");
  });

  it("uses Vercel's production or deployment hostname without hardcoding it", () => {
    expect(
      resolveServerAppOrigin({
        VERCEL_PROJECT_PRODUCTION_URL: "neurons.example.vercel.app",
      }),
    ).toBe("https://neurons.example.vercel.app");
    expect(
      resolveServerAppOrigin({ VERCEL_URL: "preview.example.vercel.app" }),
    ).toBe("https://preview.example.vercel.app");
  });

  it("does not let a stale localhost APP_URL override Vercel's deployment URL", () => {
    expect(
      resolveServerAppOrigin({
        VERCEL: "1",
        APP_URL: "http://localhost:3000",
        VERCEL_PROJECT_PRODUCTION_URL: "neurons.example.vercel.app",
      }),
    ).toBe("https://neurons.example.vercel.app");
    expect(() =>
      resolveServerAppOrigin({
        VERCEL: "1",
        APP_URL: "http://127.0.0.1:3000",
      }),
    ).toThrow("APP_URL_CONFIGURATION_MISSING");
  });

  it("fails closed when no application origin is configured", () => {
    expect(() => resolveServerAppOrigin({})).toThrow(
      "APP_URL_CONFIGURATION_MISSING",
    );
  });

  it("builds callback URLs from a validated origin and relative path", () => {
    expect(
      createAppUrl(
        "/auth/callback?next=/reset-password",
        "https://neurons.example.com",
      ),
    ).toBe("https://neurons.example.com/auth/callback?next=/reset-password");
    expect(() =>
      createAppUrl("//attacker.example", "https://neurons.example.com"),
    ).toThrow("APP_URL_PATH_INVALID");
  });
});
