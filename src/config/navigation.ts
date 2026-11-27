/**
 * 站点导航配置
 *
 * 公开站主索引。Header（桌面左侧索引栏 / 移动端索引浮层）
 * 全部从这里读取，新增页面时只改这里。
 *
 * UX R3 / N1：公开顺序写死为 首页 → 维修活动 → 关于 → 加入 → 文档（01–05）。
 */

import type { IconName } from "@/components/ui/Icon";

export const shellNavigationCopy = {
  backHome: "返回官网",
} as const;

export type NavItem = {
  /** 章节编号，用于索引栏与浮层的 "01 / 02" 标记 */
  index: string;
  /** 完整名称，用于移动端索引浮层 */
  label: string;
  /** 短名称，用于桌面索引栏的竖排文字（两字最佳） */
  shortLabel: string;
  /** 英文标签，用于索引栏辅助说明 */
  labelEn: string;
  href: string;
  /** 侧栏条目的图标（工作台重构：成员 / 管理侧栏用图标取代编号）。公开 `mainNav` 不填。 */
  icon?: IconName;
};

export const mainNav: readonly NavItem[] = [
  { index: "01", label: "首页", shortLabel: "首页", labelEn: "Home", href: "/" },
  {
    index: "02",
    label: "维修活动",
    shortLabel: "活动",
    labelEn: "Activities",
    href: "/repair-activities",
  },
  { index: "03", label: "关于我们", shortLabel: "关于", labelEn: "About", href: "/about" },
  { index: "04", label: "加入我们", shortLabel: "加入", labelEn: "Join", href: "/join" },
  { index: "05", label: "实用工具", shortLabel: "工具", labelEn: "Tools", href: "/docs" },
] as const;

/**
 * 公开站「成员登录」入口
 *
 * 故意不进 `mainNav`：索引栏编号只服务公开主栏目；账号入口挂在 Header
 * 足部 / 移动端浮层底部，以及 Footer 次要文字链，避免把 `/login`
 * （更别说 `/admin`）混进公开导航主 CTA。
 *
 * 文案与 Header 一致，定为「成员登录」（产品锁定）。
 */
export const memberLoginLink = {
  label: "成员登录",
  labelEn: "Member Login",
  href: "/login",
} as const;
