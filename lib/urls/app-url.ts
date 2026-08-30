const explicitAppOriginEnvironmentKeys = [
  "APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;
const vercelAppOriginEnvironmentKeys = [
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "APP_URL",
] as const;

function normalizeAppOrigin(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL_PROTOCOL_INVALID");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_URL_MUST_BE_ORIGIN");
  }
  return url.origin;
}

function isLoopbackOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

export function resolveServerAppOrigin(
  environment: Record<string, string | undefined>,
) {
  const isVercel =
    environment.VERCEL === "1" || Boolean(environment.VERCEL_ENV);
  const keys = isVercel
    ? vercelAppOriginEnvironmentKeys
    : explicitAppOriginEnvironmentKeys;
  for (const key of keys) {
    const value = environment[key]?.trim();
    if (!value) continue;
    const origin = normalizeAppOrigin(value);
    if (isVercel && isLoopbackOrigin(origin)) continue;
    return origin;
  }
  throw new Error("APP_URL_CONFIGURATION_MISSING");
}

export function createAppUrl(path: string, origin: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("APP_URL_PATH_INVALID");
  }
  return new URL(path, `${normalizeAppOrigin(origin)}/`).toString();
}
