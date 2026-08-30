import { describe, expect, it } from "vitest";

import { resolveSandboxAccessCredentials } from "@/lib/tools/sandbox-credentials";

describe("Sandbox credential resolution", () => {
  it("delegates authentication to the SDK when no access token is configured", () => {
    expect(resolveSandboxAccessCredentials({})).toEqual({});
    expect(
      resolveSandboxAccessCredentials({
        VERCEL: "1",
        VERCEL_PROJECT_ID: "prj_system_value",
        VERCEL_TEAM_ID: "team_system_value",
      }),
    ).toEqual({});
    expect(
      resolveSandboxAccessCredentials({ VERCEL_OIDC_TOKEN: "oidc-token" }),
    ).toEqual({});
  });

  it("uses a complete access-token credential set outside OIDC", () => {
    expect(
      resolveSandboxAccessCredentials({
        VERCEL_TOKEN: "access-token",
        VERCEL_TEAM_ID: "team_123",
        VERCEL_PROJECT_ID: "prj_123",
      }),
    ).toEqual({
      token: "access-token",
      teamId: "team_123",
      projectId: "prj_123",
    });
  });

  it("rejects a partial explicit access-token configuration", () => {
    expect(() =>
      resolveSandboxAccessCredentials({ VERCEL_TOKEN: "access-token" }),
    ).toThrow(
      "VERCEL_SANDBOX_ACCESS_CREDENTIALS_INCOMPLETE:VERCEL_TEAM_ID,VERCEL_PROJECT_ID",
    );
  });
});
