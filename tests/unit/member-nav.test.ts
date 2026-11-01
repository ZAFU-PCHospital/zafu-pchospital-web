import assert from "node:assert/strict";
import test from "node:test";

import { communityCopy } from "../../src/config/community";
import {
  MEMBER_NOTIFICATIONS_CHANGED_EVENT,
  memberCopy,
  memberNav,
  memberTabs,
} from "../../src/config/member";

/**
 * 成员端侧栏配置契约（工作台重构版）。
 *
 * 组件本身依赖 `next/navigation`，这里只锁配置层：
 * - 侧栏按 4 组平铺全部 9 个入口（概览 / 维修 / 互动 / 账户），不再有足部「设置」菜单；
 * - 编号延续公开 01–05 之后整段 +1 → 06–14，且全局唯一；
 * - 每条都有 `shortLabel`（窄屏标签栏短标）与 `label`；
 * - 入口位置变了，页面与接口不变，所有 href 必须仍然可达。
 */

test("侧栏按 4 组平铺 9 个入口（概览 / 维修 / 互动 / 账户）", () => {
  assert.deepEqual(
    memberNav.map((group) => group.title),
    ["概览", "维修", "互动", "账户"],
  );
  assert.deepEqual(
    memberNav.flatMap((group) => group.items).map((item) => item.href),
    [
      "/member",
      "/member/repairs",
      "/member/repairs/new",
      "/member/repair-activities",
      "/member/cases",
      "/member/notifications",
      "/member/favorites",
      "/member/rankings",
      "/member/profile",
    ],
  );
});

test("成员导航编号为 06–14（公开 01–05 后整段 +1），且全局唯一", () => {
  const items = memberNav.flatMap((group) => group.items);
  assert.deepEqual(
    items.map((item) => item.index),
    ["06", "07", "08", "09", "10", "11", "12", "13", "14"],
  );
  assert.equal(new Set(items.map((item) => item.index)).size, items.length, "成员端入口编号重复");
});

test("每条入口都有 shortLabel（窄屏标签栏用短标）", () => {
  for (const item of memberNav.flatMap((group) => group.items)) {
    assert.ok(item.shortLabel.length > 0, `${item.href} 缺 shortLabel`);
    assert.ok(item.label.length > 0, `${item.href} 缺 label`);
  }
});

test("窄屏底部标签栏无障碍名来自 memberCopy.shell.tabbarLabel", () => {
  assert.equal(memberCopy.shell.tabbarLabel, "成员快捷导航");
});

test("标记已读后刷新事件名为 member:notifications-changed", () => {
  assert.equal(MEMBER_NOTIFICATIONS_CHANGED_EVENT, "member:notifications-changed");
});

test("未读条数仍由 communityCopy.notifications.unreadCount 提供（页面与工作台摘要共用）", () => {
  assert.match(communityCopy.notifications.unreadCount, /\{count\}/);
  assert.equal(communityCopy.notifications.unreadCount.replace("{count}", "3"), "未读 3 条");
  assert.equal(communityCopy.notifications.unreadCount.replace("{count}", "150"), "未读 150 条");
});

test("窄屏底部标签栏：活动替代消息，消息仍保留在工作台快捷入口", () => {
  // 锁完整配置：顺序、文案、图标、exact / primary 任一被改回都会失败。
  assert.deepEqual(memberTabs, [
    { href: "/member", label: "工作台", icon: "home", exact: true },
    { href: "/member/repairs", label: "维修", icon: "fileText" },
    { href: "/member/repairs/new", label: "新增", icon: "plus", primary: true },
    { href: "/member/repair-activities", label: "活动", icon: "calendar" },
    { href: "/member/profile", label: "我的", icon: "user" },
  ]);
  assert.equal(
    (memberTabs as readonly { href: string }[]).some((tab) => tab.href === "/member/notifications"),
    false,
  );
  assert.ok(
    memberNav.flatMap((group) => group.items).some((item) => item.href === "/member/notifications"),
    "桌面侧栏仍保留消息入口",
  );
});
