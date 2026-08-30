export function extractRunFailureCode(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 120);
  }
  if (typeof error === "string" && error) {
    return error.slice(0, 120);
  }
  if (error && typeof error === "object") {
    for (const key of ["message", "code", "name"] as const) {
      const value = Reflect.get(error, key);
      if (typeof value === "string" && value) return value.slice(0, 120);
    }
  }
  return "RUN_FAILED";
}

export function runFailureMessage(failureCode: string | null) {
  switch (failureCode) {
    case "TEAM_MODE_NOT_CONFIGURED":
      return "Team Mode 尚未接入执行器，请切换到 Engineer Mode 后重试。";
    case "MODEL_AUTH_FAILED":
      return "模型服务认证失败，请检查服务端模型配置。";
    case "MODEL_RATE_LIMITED":
      return "模型服务当前请求过多，请稍后重试。";
    case "MODEL_STREAM_INTERRUPTED":
      return "模型响应在传输过程中中断，请重新发送。";
    case "MODEL_INVALID_REQUEST":
      return "模型服务拒绝了本次请求，请查看 Trace 中的诊断信息。";
    case "MODEL_REQUEST_FAILED":
      return "模型服务请求失败，请稍后重试。";
    default:
      return "任务未能完成。你的输入已保留，可以查看 Trace 后重试。";
  }
}
