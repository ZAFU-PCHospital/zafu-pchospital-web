import { AppError } from "@/lib/api/errors";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * 键里带客户端 IP，是攻击者可控的：没有上限时，一个扫描器换着 IP 发请求就能把桶表
 * 撑到任意大小，把只有 1.6G 内存的进程推向 OOM（2026-09 安全审计 F2）。
 */
const MAX_BUCKETS = 10_000;

/** Single-instance M0 limiter. Production multi-instance deployment must replace this store. */
export function enforceRateLimit(key: string, limit = 10, windowMs = 60_000): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    makeRoom();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new AppError("RATE_LIMITED", "请求过于频繁，请稍后再试");
}

/**
 * 满员时从最旧的桶开始淘汰（Map 迭代即插入顺序，过期桶天然排在最前）。
 * 被误淘汰的活动桶只会让那个键重新计数 —— 边缘还有 nginx 限流兜底，放宽一点可以接受。
 */
function makeRoom(): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const key of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}
