export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json()) as {
    data?: T;
    error?: { code: string; message: string; retryable: boolean };
  };

  if (!response.ok || body.error) {
    const error = body.error ?? {
      code: "UNKNOWN_ERROR",
      message: "请求失败。",
      retryable: response.status >= 500,
    };
    throw new ApiClientError(error.code, response.status, error.message, error.retryable);
  }
  return body.data as T;
}
