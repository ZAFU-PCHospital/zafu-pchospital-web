/**
 * 客户端 IP：只信反向代理**覆写**的 `X-Real-IP`。
 *
 * 不能取 `X-Forwarded-For` 的第一段：nginx 的 `$proxy_add_x_forwarded_for` 是
 * 「客户端自带值 + ", " + 真实地址」，客户端伪造的值恰好排在最前，于是每个请求
 * 都能换一个"新 IP"，登录节流与接口限流形同虚设（2026-09 安全审计 F1 实测复现）。
 * 反向代理已改为覆写 `X-Real-IP` / `X-Forwarded-For`；没有代理时（本地开发、
 * 直连调试）退回 `X-Forwarded-For` 的最后一段 —— 它是最靠近服务端的一跳。
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").pop()?.trim();
  return last || "unknown";
}
