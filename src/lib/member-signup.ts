import { pad2 } from "@/lib/utils";

/**
 * 新社员登记 —— 前端与后续后端之间的接口层
 *
 * 第一阶段不实现数据库、鉴权与 API 路由（见 AGENTS.md 第 3 节），
 * 因此这里**不发起任何网络请求**：submitMemberSignup 直接返回一份本地回执，
 * 先把页面上「填写 → 提交 → 显示招新群二维码」这条链路跑通。
 *
 * 接入后端时只需要改这一个文件：
 *   1. 设置 NEXT_PUBLIC_MEMBER_SIGNUP_ENDPOINT 指向真实接口；
 *   2. 按后端返回结构补完下面 fetch 分支里的字段映射。
 * 调用方（components/join/MemberSignup.tsx）不需要任何改动。
 *
 * 字段命名与《电脑医院社团综合服务平台需求分析》第 16 章的数据模型对齐：
 *   qq       -> users.qq / member_candidates.qq
 *   realName -> member_profiles.real_name
 *   phone    -> users.phone
 */

/** 提交给后端的登记数据。字段名即接口字段名，不要在页面里另起别名。 */
export type MemberSignupInput = {
  qq: string;
  realName: string;
  phone: string;
};

export type MemberSignupReceipt = {
  ok: true;
  /** 回执编号。接入后端后改为服务端返回的记录 id */
  ticket: string;
  /** ISO 时间字符串 */
  submittedAt: string;
};

export type MemberSignupFailure = {
  ok: false;
  /** 失败分类，供页面决定提示方式；不要用文案做判断 */
  reason: "offline" | "duplicate" | "invalid" | "unknown";
  /** 可直接展示给填写者的中文说明 */
  message: string;
};

export type MemberSignupResult = MemberSignupReceipt | MemberSignupFailure;

/**
 * 后端接入点。
 *
 * 空字符串 = 尚未接入后端，此时 submitMemberSignup 走本地回执分支，
 * 页面上不会上传任何内容（页面已按此标注「待接入」）。
 * 接口就绪后设置 NEXT_PUBLIC_MEMBER_SIGNUP_ENDPOINT 即可切换。
 */
export const memberSignupEndpoint: string = process.env.NEXT_PUBLIC_MEMBER_SIGNUP_ENDPOINT ?? "";

/**
 * 从表单取出登记数据并规范化。
 *
 * 必填与格式约束由原生约束校验（required / pattern / maxLength）负责，
 * 这里是「用户已经填对」之后的清理：去掉首尾空白、去掉 QQ 与手机号里的
 * 分隔符（138 0000 0000 这类写法很常见），并统一姓名中的空白。
 */
export function normalizeMemberSignup(data: FormData): MemberSignupInput {
  const text = (key: string) => String(data.get(key) ?? "").trim();

  return {
    qq: text("qq").replace(/\D/g, ""),
    realName: text("realName").replace(/\s+/g, ""),
    phone: text("phone").replace(/\D/g, ""),
  };
}

/** 本地回执编号，形如 SIGNUP-20250101-4F2A。接入后端后由服务端生成 */
function localTicket(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const tail = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `SIGNUP-${date}-${tail}`;
}

/**
 * 提交登记信息。
 *
 * 未接入后端时返回本地回执，不产生任何网络请求，也不写入任何存储。
 */
export async function submitMemberSignup(input: MemberSignupInput): Promise<MemberSignupResult> {
  if (memberSignupEndpoint) {
    try {
      const response = await fetch(memberSignupEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (response.status === 409) {
        return {
          ok: false,
          reason: "duplicate",
          message: "该 QQ 号已登记过，请直接扫码加入招新群。",
        };
      }

      if (response.status === 400) {
        return {
          ok: false,
          reason: "invalid",
          message: "信息未通过校验，请检查 QQ 号、姓名与手机号。",
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          reason: "unknown",
          message: "提交失败，请稍后重试，或直接扫码加入招新群。",
        };
      }

      const payload: unknown = await response.json();
      const record = payload as { id?: string | number; submittedAt?: string } | null;

      return {
        ok: true,
        ticket: String(record?.id ?? ""),
        submittedAt: record?.submittedAt ?? new Date().toISOString(),
      };
    } catch {
      return { ok: false, reason: "offline", message: "网络异常，没能把信息送出去，请稍后重试。" };
    }
  }

  return { ok: true, ticket: localTicket(), submittedAt: new Date().toISOString() };
}
