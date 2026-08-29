import { ApiError } from "./errors";

const MAX_JSON_BYTES = 1024 * 1024;

export function requestId(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && supplied.length <= 100 ? supplied : crypto.randomUUID();
}

export function requireIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiError(
      "INVALID_IDEMPOTENCY_KEY",
      400,
      "写请求必须提供 8–200 个字符的 Idempotency-Key。",
    );
  }
  return key;
}

export async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_JSON_BYTES) {
    throw new ApiError("REQUEST_TOO_LARGE", 413, "请求内容超过 1 MiB 限制。", false);
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    throw new ApiError("REQUEST_TOO_LARGE", 413, "请求内容超过 1 MiB 限制。", false);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_JSON", 400, "请求不是有效的 JSON。", false);
  }
}
