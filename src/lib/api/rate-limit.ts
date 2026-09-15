import { AppError } from "@/lib/api/errors";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Single-instance M0 limiter. Production multi-instance deployment must replace this store. */
export function enforceRateLimit(key: string, limit = 10, windowMs = 60_000): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new AppError("RATE_LIMITED", "请求过于频繁，请稍后再试");
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
