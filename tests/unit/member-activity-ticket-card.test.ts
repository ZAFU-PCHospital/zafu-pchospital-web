import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { ReactElement, ReactNode } from "react";

import { ActivityTicketCardShell } from "../../src/components/repair-activities/ActivityTicketCardShell";
import { MemberRepairActivityTicketCard } from "../../src/components/repair-activities/MemberRepairActivityTicketCard";
import type { StaffActivityListItem } from "../../src/features/repair-activities/repair-activity-staff-service";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
(globalThis as unknown as { React: typeof React }).React = React;

type Props = { children?: ReactNode };

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) {
    if (typeof node.type === "function") {
      return text((node.type as (props: Props) => ReactNode)(node.props));
    }
    return text(node.props.children);
  }
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  return "";
}

const activity: StaffActivityListItem = {
  id: "activity-1",
  title: "秋季义务维修",
  location: "学 3-301 活动室",
  activityAt: "2026-11-02T10:00:00Z",
  endsAt: "2026-11-02T12:00:00Z",
  capacity: 10,
  signupOpensAt: "2026-10-28T04:00:00Z",
  signupClosesAt: "2026-11-02T09:00:00Z",
  status: "CLOSED",
  registeredCount: 3,
  remaining: 7,
  attended: true,
};

test("成员活动卡复用票根壳，保留成员字段与工作台入口", () => {
  const card = MemberRepairActivityTicketCard({ activity });
  assert.equal(card.type, ActivityTicketCardShell);

  const props = card.props as { href: string; meta: ReactNode; footer: ReactNode };
  assert.equal(props.href, "/member/repair-activities/activity-1");

  const meta = text(props.meta);
  assert.ok(meta.includes("活动时间"));
  assert.ok(meta.includes("18:00"));
  assert.ok(meta.includes("名额 3 / 10"));
  assert.ok(meta.includes("已出勤"));
  // issue #367：卡片额外给出签到窗口信息，成员不必点进工作台才知道能否操作。
  assert.ok(meta.includes("签到"));

  const footer = text(props.footer);
  assert.ok(footer.includes("报名已截止"));
  assert.ok(footer.includes("进入工作台"));
});

test("签到窗口（issue #367）：未开放显示具体开放时刻，开放后显示已开放，已结束不显示", () => {
  const meta = (item: StaffActivityListItem) =>
    text((MemberRepairActivityTicketCard({ activity: item }).props as { meta: ReactNode }).meta);

  // 活动 2099-01-01 10:00（上海）→ 窗口 09:30 开放；未到时刻显示具体开放时刻。
  assert.ok(meta({ ...activity, status: "OPEN", activityAt: "2099-01-01T02:00:00Z" }).includes(
    "2099/01/01 09:30",
  ));
  // 活动时间已过 → 窗口已开放。
  assert.ok(meta({ ...activity, status: "OPEN" }).includes("签到已开放"));
  // 已结束的活动不再提示签到窗口。
  assert.equal(meta({ ...activity, status: "ENDED" }).includes("签到"), false);
});

test("成员活动卡覆盖成员端五态，且始终可进入工作台", () => {
  const labels = {
    UPCOMING: "未开始",
    OPEN: "报名中",
    FULL: "已报满",
    CLOSED: "报名已截止",
    ENDED: "已结束",
  } as const;

  for (const status of Object.keys(labels) as (keyof typeof labels)[]) {
    const card = MemberRepairActivityTicketCard({ activity: { ...activity, status } });
    const props = card.props as { href: string; footer: ReactNode };
    assert.equal(props.href, "/member/repair-activities/activity-1");
    assert.ok(text(props.footer).includes(labels[status]));
  }
});

test("成员票根壳输出日期桩与状态 class", () => {
  const card = MemberRepairActivityTicketCard({ activity });
  const props = card.props as {
    activity: StaffActivityListItem;
    meta: ReactNode;
    footer: ReactNode;
  };
  const shell = ActivityTicketCardShell({
    activity: props.activity,
    href: "/member/repair-activities/activity-1",
    meta: props.meta,
    footer: props.footer,
  });

  const link = shell as ReactElement<{
    href?: string;
    children?: ReactElement<{ className?: string }>;
  }>;
  assert.equal(link.props.href, "/member/repair-activities/activity-1");
  const ticket = link.props.children;
  assert.ok(ticket);
  assert.ok(ticket.props.className?.includes("activity-card--stub"));
  assert.ok(ticket.props.className?.includes("activity-card--closed"));
});
