import { AppError } from "@/lib/api/errors";

/**
 * 管理端 HTTP 入参解析（M6 批次 2）。
 *
 * 与 `features/repairs/repair-http.ts` 同一思路：把「请求里来的都是 `unknown`」这件事
 * 收敛到一层显式白名单里，**不在 Route Handler 里 parseInt / Boolean(...)**。
 * 单独一份而不是复用 `repair-http.ts`：那个文件的解析器都带维修领域语义
 * （`repairListInput`、`draftInput`），塞进技能 / 审计 / 设置的白名单会互相牵扯。
 */

/** 查询参数：空串按「未提供」处理，避免界面清空输入框后送出 `?status=`。 */
export function queryString(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value?.trim() ? value : undefined;
}

/** 查询参数里的枚举白名单。非法值 400 而不是静默忽略（静默忽略会让筛选看起来失效）。 */
export function queryOneOf<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = queryString(params, key);
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new AppError("VALIDATION_FAILED", `${key} 参数无效`);
  }
  return value as T;
}

/** 请求体里的枚举白名单（必填）。 */
export function bodyOneOf<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = body[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new AppError("VALIDATION_FAILED", `${key} 参数无效`);
  }
  return value as T;
}

/** 请求体里的必填布尔字段。缺字段一律 400，不静默当 false（与 `requiredBool` 同一条规则）。 */
export function bodyBool(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new AppError("VALIDATION_FAILED", `${key} 必须是布尔值`);
  }
  return value;
}

/** 请求体里的必填字符串。空串视为缺失。 */
export function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("VALIDATION_FAILED", `${key} 不能为空`);
  }
  return value;
}

/** 请求体里的选填字符串：缺字段与 `null` 都返回 `undefined`。 */
export function bodyOptionalString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new AppError("VALIDATION_FAILED", `${key} 必须是字符串`);
  return value;
}

/** 请求体里的选填整数。非整数、超范围一律 400。 */
export function bodyOptionalInt(
  body: Record<string, unknown>,
  key: string,
  range: { min: number; max: number },
): number | undefined {
  if (!(key in body) || body[key] === null || body[key] === undefined) return undefined;
  const value = Number(body[key]);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new AppError("VALIDATION_FAILED", `${key} 必须是 ${range.min}–${range.max} 的整数`);
  }
  return value;
}

/**
 * 请求体里的「可空字符串」（拖动排序的落点：`beforeId`）。
 *
 * 与 {@link bodyOptionalString} 的区别是这个字段**必须存在**：`null` 是有意义的值
 * （拖到末尾），缺字段说明调用方写错了，静默当成「没变化」会让拖动看起来失效。
 */
export function bodyNullableString(body: Record<string, unknown>, key: string): string | null {
  if (!(key in body)) throw new AppError("VALIDATION_FAILED", `${key} 字段缺失`);
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("VALIDATION_FAILED", `${key} 必须是非空字符串或 null`);
  }
  return value;
}
