export type SandboxAccessCredentials =
  Record<string, never> | { teamId: string; projectId: string; token: string };

export function resolveSandboxAccessCredentials(
  environment: Record<string, string | undefined>,
): SandboxAccessCredentials {
  const token = environment.VERCEL_TOKEN?.trim();
  if (!token) {
    // Let @vercel/sandbox resolve OIDC from the Vercel request/workflow context
    // or VERCEL_OIDC_TOKEN in local development.
    return {};
  }

  const teamId = environment.VERCEL_TEAM_ID?.trim();
  const projectId = environment.VERCEL_PROJECT_ID?.trim();
  const missing = [
    teamId ? null : "VERCEL_TEAM_ID",
    projectId ? null : "VERCEL_PROJECT_ID",
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    throw new Error(
      `VERCEL_SANDBOX_ACCESS_CREDENTIALS_INCOMPLETE:${missing.join(",")}`,
    );
  }

  return { teamId: teamId!, projectId: projectId!, token };
}
