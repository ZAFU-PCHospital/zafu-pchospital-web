import { loginDestination } from "@/lib/auth/login-destination";
import { isActivityObjectPath } from "@/lib/auth/activity-workspace-access";
import { EMAIL_STEP_PATH, PASSWORD_STEP_PATH } from "@/lib/auth/account-steps";
import { getDb } from "@/lib/db/client";
import { getEmailGateMode, type EmailGateMode } from "@/lib/env";
import { readEmailAccessState } from "@/features/email/email-access-state";
import type { AccountAccessView, RoleCode, SessionPrincipal } from "@/types/contracts";

/**
 * 统一账号门禁。
 *
 * 页面守卫与业务 API 共用这里的同一份判定，不在每个消费者各写一套：
 * 有效 Session / 账号资格（由调用方完成）→ 必须改密 → 当前模式需要邮箱且无有效豁免
 * → 合法原目标或角色默认页。
 *
 * 依赖方向固定为 `守卫 → 本模块 → 状态读取`：本模块不调用本人邮箱 HTTP、不递归
 * `authenticate`、不解析 SMTP 配置，也不引入发信能力（否则会出现
 * `request → 邮箱 Service → request` 的环）。邮件关闭 / SMTP 故障 / 预算不足
 * 都不会让门禁失效 —— 门禁只看模式、资格、邮箱与豁免。
 *
 * 这里**不写** `import "server-only"`：该包只在 Next 打包时可用，而本模块会被
 * tsx 直接跑的集成测试（经邮箱 Service）与判定单测导入，加上就会断链。
 */

/**
 * 候选回跳目标的**形状**规则（不含角色判定）：只收规范的 `/member` / `/admin` 业务 pathname。
 *
 * 拒绝：外部地址、双斜杠、反斜杠、控制字符与空格、查询串 / 片段 / 百分号编码歧义，
 * 以及登录 / API / 改密 / 邮箱步骤页自环（正则白名单天然排除这些前缀）。
 * 不做二次 decode：调用方传什么就按什么判定。
 *
 * 单独导出是给**尚未认证**的那一跳用（页面守卫发现没有有效会话时，只能按形状带上
 * 原目标；此刻没有角色可查）。它永远只是候选：真正的准入判定在
 * {@link safeAccountReturnPath}，由认证之后的当次角色把关。
 */
export function accountReturnCandidate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (/[\\\u0000-\u0020\u007f%?#]/.test(value)) return null;
  if (!/^\/(member|admin)(\/[-a-zA-Z0-9]+)*\/?$/.test(value)) return null;
  return value;
}

/**
 * 安全回跳（任务 4 规则提取到此处，登录 / 改密 / 邮箱与页面守卫共用）：
 * 在候选形状之上再加**当前角色**这一道 —— 成员不能把落点定到后台，反之亦然。
 */
export function safeAccountReturnPath(
  value: string | null | undefined,
  roles: readonly RoleCode[],
): string | null {
  const candidate = accountReturnCandidate(value);
  if (!candidate) return null;
  if (candidate.startsWith("/admin") && !roles.includes("ADMIN")) {
    // 成员的 activity:staff 权限只允许活动对象页；其他后台目标仍由 ADMIN 把关。
    if (!roles.includes("MEMBER") || !isActivityObjectPath(candidate)) return null;
  }
  if (candidate.startsWith("/member") && !roles.includes("MEMBER")) return null;
  return candidate;
}

function stepPath(step: string, returnTo: string | null): string {
  return returnTo ? `${step}?returnTo=${encodeURIComponent(returnTo)}` : step;
}

export type AccountAccessDecision = {
  mustChangePassword: boolean;
  roles: readonly RoleCode[];
  mode: EmailGateMode;
  /** 是否存在有效且已验证的邮箱身份。`mode = off` 时不参与判定。 */
  emailVerified: boolean;
  /** 有效豁免的到期时间；无豁免 / 已到期为 `null`。 */
  exemptionExpiresAt: Date | null;
  /** 本次判定使用的服务端时间（读取完成之后）。 */
  now: Date;
  /** 已经过 `safeAccountReturnPath` 校验的原目标；无合法目标为 `null`。 */
  returnTo: string | null;
};

/**
 * 纯判定（无 IO，表驱动单测直接打这里）。
 *
 * 顺序固定：改密优先于邮箱；豁免只豁免邮箱这一步，既不绕过改密，也不授予
 * 成员 / 管理权限或找回资格。
 */
export function decideAccountAccess(input: AccountAccessDecision): AccountAccessView {
  const exemption =
    input.exemptionExpiresAt && input.exemptionExpiresAt > input.now
      ? input.exemptionExpiresAt
      : null;
  const view = { exemptionExpiresAt: exemption ? exemption.toISOString() : null };
  if (input.mustChangePassword)
    return {
      ...view,
      state: "PASSWORD_CHANGE_REQUIRED",
      destination: stepPath(PASSWORD_STEP_PATH, input.returnTo),
    };
  const gateApplies =
    input.mode === "all" || (input.mode === "admin" && input.roles.includes("ADMIN"));
  if (gateApplies && !input.emailVerified && !exemption)
    return {
      ...view,
      state: "EMAIL_VERIFICATION_REQUIRED",
      destination: stepPath(EMAIL_STEP_PATH, input.returnTo),
    };
  return {
    ...view,
    state: "READY",
    destination:
      input.returnTo ?? loginDestination({ roles: input.roles, mustChangePassword: false }),
  };
}

/**
 * 按**当次**持久化状态判定某个主体的访问结论。
 *
 * `mode = off` 时完全不读邮箱表（保持既有「邮箱非强制」行为与开销）。
 */
export async function resolveAccountAccess(input: {
  principal: Pick<SessionPrincipal, "userId" | "roles" | "mustChangePassword">;
  returnTo?: string | null;
  now?: () => Date;
}): Promise<AccountAccessView> {
  const mode = getEmailGateMode();
  const returnTo = safeAccountReturnPath(input.returnTo, input.principal.roles);
  const email =
    mode === "off" ? null : await readEmailAccessState(getDb(), input.principal.userId, input.now);
  return decideAccountAccess({
    mustChangePassword: input.principal.mustChangePassword,
    roles: input.principal.roles,
    mode,
    emailVerified: email !== null && email.outcome.kind === "VERIFIED",
    exemptionExpiresAt: email?.exemption?.expiresAt ?? null,
    now: email?.at ?? input.now?.() ?? new Date(),
    returnTo,
  });
}
