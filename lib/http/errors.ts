import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new ApiError("INVALID_REQUEST", 400, "请求内容不符合要求。", false, {
      issues: error.issues.map(({ path, message }) => ({ path, message })),
    });
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return new ApiError("AUTH_REQUIRED", 401, "请先登录后再继续。", false);
  }
  if (error instanceof Error && error.message === "SUPABASE_CONFIGURATION_MISSING") {
    return new ApiError(
      "SERVICE_NOT_CONFIGURED",
      503,
      "Supabase 尚未配置，暂时无法访问项目数据。",
      false,
    );
  }

  return new ApiError("INTERNAL_ERROR", 500, "服务暂时不可用，请稍后重试。", true);
}

export function errorResponse(error: unknown, requestId: string) {
  const apiError = toApiError(error);
  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        retryable: apiError.retryable,
        requestId,
        details: apiError.details,
      },
    },
    { status: apiError.status },
  );
}
