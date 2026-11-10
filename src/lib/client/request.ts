import { clientRequestCopy } from "@/config/client-request";
import type { PaginationMeta } from "@/types/contracts";

export const REQUEST_TIMEOUT_MS = 15_000;

export class ClientRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ClientRequestError";
  }
}

export function requestError(error: unknown): ClientRequestError {
  return error instanceof ClientRequestError
    ? error
    : new ClientRequestError("NETWORK_ERROR", clientRequestCopy.network);
}

/** 超时覆盖响应体读取；即使底层忽略 signal，也会结束等待并清理监听器。 */
export async function withRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new ClientRequestError("REQUEST_ABORTED", clientRequestCopy.aborted));
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new ClientRequestError("REQUEST_TIMEOUT", clientRequestCopy.timeout)),
    timeoutMs,
  );
  let onAbort: () => void = () => {};
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

type JsonResponse<T> = { data: T; meta?: { pagination?: PaginationMeta } };

export function requestJson<T>(path: string, init: RequestInit = {}): Promise<JsonResponse<T>> {
  return withRequest(
    async (signal) => {
      let response: Response;
      try {
        response = await fetch(path, { ...init, signal });
      } catch (error) {
        throw requestError(error);
      }
      let json: {
        success?: boolean;
        data?: T;
        meta?: JsonResponse<T>["meta"];
        error?: { code?: string; message?: string };
      };
      try {
        json = await response.json();
      } catch {
        throw new ClientRequestError(
          "INVALID_RESPONSE",
          clientRequestCopy.invalidResponse,
          response.status,
        );
      }
      if (!response.ok || json?.success !== true || json.data === undefined) {
        throw new ClientRequestError(
          json?.error?.code ?? "INVALID_RESPONSE",
          json?.error?.message ?? clientRequestCopy.failed,
          response.status,
        );
      }
      return { data: json.data, meta: json.meta };
    },
    { signal: init.signal ?? undefined },
  );
}
