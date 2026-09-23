import type { FieldErrors } from "@/lib/api/errors";
import type { PaginationMeta } from "@/types/contracts";

/**
 * 管理后台的客户端 API 调用封装（M6）。
 *
 * 为什么新增这个：仓库里已有 37 处裸 `fetch` + 手写信封判断，但**没有任何统一封装**
 * 与「错误码 → 界面文案」的映射。后台有 15+ 个调用点，逐处手写会出现各不相同的
 * 会话失效处理与漏判 `success: false`。因此这里只服务 `/api/v1/admin/*`，
 * **不改动任何既有调用点**（避免无谓地重写团队已完成的内容）。
 *
 * 统一处理三件事：
 * 1. 解析 `{ success, data, error, meta }` 信封，非成功一律转成结构化失败；
 * 2. 401/403 的会话与权限语义统一成可展示文案（含 `PASSWORD_CHANGE_REQUIRED`）；
 * 3. 网络异常不再泄漏成 `TypeError: Failed to fetch`。
 */
export type AdminApiResult<T> =
  | { ok: true; data: T; pagination?: PaginationMeta }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: FieldErrors;
      status: number;
    };

/**
 * GET 结果的短期缓存（M6 第三轮验收：切换页面「停顿感明显」）。
 *
 * 后台每个页面挂载时都要发一次 GET，来回切页就是「等一次服务端往返」的重复体验。
 * 这里把 GET 结果保留 15 秒：重新进入同一个列表、重开同一个详情窗口时**立刻**出内容。
 *
 * 失效规则只有一条，但足够安全：**任何写请求都会清空整个缓存**。
 * 后台的写操作一定会跟着一次 `load()` 重取，因此不会出现「改完还是旧数据」。
 * 15 秒的上限则覆盖了「另一个管理员同时改了数据」这种跨会话的情况 ——
 * 超过这个时间就重新取，最坏情况下界是 15 秒的陈旧窗口。
 */
const GET_CACHE_TTL_MS = 15_000;
const getCache = new Map<string, { at: number; value: AdminApiResult<unknown> }>();

/** 预热：鼠标悬停在「详情」之类按钮上时先把数据取回来，点下去就不用等。 */
export function prefetchAdmin(path: string): void {
  void adminFetch(path);
}

/** 手动失效（测试或已知数据变化的场景用；正常写路径会自动清空）。 */
export function clearAdminCache(): void {
  getCache.clear();
}

export async function adminFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<AdminApiResult<T>> {
  const method = init.method ?? "GET";
  const isRead = method === "GET";
  if (isRead) {
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.at < GET_CACHE_TTL_MS) {
      return hit.value as AdminApiResult<T>;
    }
  } else {
    // 写操作可能改变任何列表的内容，整体失效比逐个推断前缀可靠。
    getCache.clear();
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR", message: "网络异常，请检查连接后重试", status: 0 };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message: "服务返回了无法解析的响应",
      status: response.status,
    };
  }

  const envelope = json as {
    success?: boolean;
    data?: T;
    error?: { code?: string; message?: string; fieldErrors?: FieldErrors };
    meta?: { pagination?: PaginationMeta };
  };

  if (envelope.success === true) {
    const ok: AdminApiResult<T> = {
      ok: true,
      data: envelope.data as T,
      pagination: envelope.meta?.pagination,
    };
    if (isRead) getCache.set(path, { at: Date.now(), value: ok });
    return ok;
  }
  const code = envelope.error?.code ?? "UNKNOWN_ERROR";
  return {
    ok: false,
    code,
    message: sessionMessage(code, envelope.error?.message),
    fieldErrors: envelope.error?.fieldErrors,
    status: response.status,
  };
}

/** 会话/权限类错误统一成对管理员可操作的文案；其余沿用服务端文案。 */
function sessionMessage(code: string, fallback?: string): string {
  if (
    code === "UNAUTHENTICATED" ||
    code === "AUTH_SESSION_INVALID" ||
    code === "AUTH_SESSION_EXPIRED"
  )
    return "登录状态已失效，请重新登录后再操作。";
  if (code === "PASSWORD_CHANGE_REQUIRED") return "请先修改初始密码，再使用管理后台。";
  if (code === "FORBIDDEN") return "当前账号没有执行该操作的权限。";
  return fallback ?? "操作失败，请稍后重试";
}

/** 把服务端的 `fieldErrors` 摊平成一行可展示文案（取首个字段的第一条）。 */
export function firstFieldError(fieldErrors: FieldErrors | undefined): string | undefined {
  if (!fieldErrors) return undefined;
  for (const messages of Object.values(fieldErrors)) {
    if (messages && messages.length > 0) return messages[0];
  }
  return undefined;
}
