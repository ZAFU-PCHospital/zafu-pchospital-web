import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { ReactNode } from "react";

import { repairActivitiesPage } from "../../src/config/repair-activities";
import type {
  RegistrationPublicView,
  RepairActivityPublicView,
} from "../../src/features/repair-activities/repair-activity-service";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
(globalThis as unknown as { React: typeof React }).React = React;

/** 组件 import 了 CSS Module：测试里换成空对象，只为读 JSX 结构。 */
const originalCss = require.extensions[".css"];
require.extensions[".css"] = (module: { exports: unknown }) => {
  module.exports = {};
};

type Props = { children?: ReactNode };

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}

const page = repairActivitiesPage;
const copy = repairActivitiesPage.detail.receipt;

/** 上海 10-24 18:00 开始、20:00 结束，地点齐备。 */
const activity = {
  id: "a1",
  title: "秋季义务维修（第 3 场）",
  location: "学 3-301 活动室",
  activityAt: "2026-10-24T10:00:00Z",
  endsAt: "2026-10-24T12:00:00Z",
  capacity: 30,
  signupOpensAt: "2026-10-18T00:00:00Z",
  signupClosesAt: "2026-10-24T09:00:00Z",
  status: "OPEN",
  registeredCount: 12,
  remaining: 18,
} satisfies RepairActivityPublicView;

const registration = {
  id: "r1",
  activityId: "a1",
  name: "测试客户",
  phoneMasked: "138****0000",
  issueType: "CLEAN_PASTE",
  deviceModel: "测试机型",
  status: "REGISTERED",
  createdAt: "2026-10-24T04:00:01Z",
} satisfies RegistrationPublicView;

async function load() {
  const { RepairActivityReceipt } =
    await import("../../src/components/repair-activities/RepairActivityReceipt");
  return RepairActivityReceipt;
}

test("凭条集中展示活动、起止时间、地点与报名信息", async () => {
  const RepairActivityReceipt = await load();
  const content = text(RepairActivityReceipt({ activity, registration }));

  assert.ok(content.includes(copy.kicker), "凭条要有「报名凭条」抬头");
  assert.ok(content.includes(activity.title), "活动名称");
  assert.ok(content.includes(page.activityAt), "活动时间标签");
  assert.ok(content.includes("2026/10/24 18:00–20:00"), "同日区间只显示一次日期");
  assert.ok(content.includes(page.location), "地点标签");
  assert.ok(content.includes(activity.location!), "地点值");
  assert.ok(content.includes(registration.name), "姓名");
  assert.ok(content.includes(registration.phoneMasked), "脱敏手机");
  assert.ok(content.includes(copy.registeredAt), "报名时间标签");
  assert.ok(content.includes("2026/10/24 12:00"), "报名时间值");
  assert.ok(content.includes(page.detail.issueType), "故障类型标签");
  assert.ok(content.includes("清灰换硅脂"), "故障类型文案");
  assert.ok(content.includes(copy.deviceModel), "机型标签");
  assert.ok(content.includes(registration.deviceModel!), "机型值");
  assert.ok(content.includes(copy.screenshotHint), "截图提示");
});

test("地点为空时整行不渲染，不编造占位", async () => {
  const RepairActivityReceipt = await load();
  const content = text(
    RepairActivityReceipt({ activity: { ...activity, location: null }, registration }),
  );
  assert.equal(content.includes(page.location), false, "没有地点就不出现「地点」标签");
  assert.ok(content.includes("2026/10/24 18:00–20:00"), "时间行仍在");
});

test("机型为空时不渲染机型行", async () => {
  const RepairActivityReceipt = await load();
  const content = text(
    RepairActivityReceipt({ activity, registration: { ...registration, deviceModel: null } }),
  );
  assert.equal(content.includes(copy.deviceModel), false);
  assert.ok(content.includes("清灰换硅脂"));
});

test("跨天区间两端都显示完整日期时间；结束时间为空时只显示开始时刻", async () => {
  const RepairActivityReceipt = await load();

  const crossDay = text(
    RepairActivityReceipt({
      activity: { ...activity, activityAt: "2026-10-24T14:00:00Z", endsAt: "2026-10-24T17:00:00Z" },
      registration,
    }),
  );
  assert.ok(crossDay.includes("2026/10/24 22:00 — 2026/10/25 01:00"));

  const legacy = text(
    RepairActivityReceipt({ activity: { ...activity, endsAt: null }, registration }),
  );
  assert.ok(legacy.includes("2026/10/24 18:00"));
  assert.equal(legacy.includes("–"), false, "没有结束时间就不拼区间");
});

test("到场准备压成一行要点，完整说明不在凭条里展开", async () => {
  const { RepairActivityPreparation } =
    await import("../../src/components/repair-activities/RepairActivityPreparation");
  const inline = text(RepairActivityPreparation({ layout: "inline" }));

  for (const item of page.detail.preparation) {
    assert.ok(inline.includes(item.title), item.title);
    assert.equal(inline.includes(item.description), false, "凭条里只保留标题");
  }
});

test.after(() => {
  if (originalCss) require.extensions[".css"] = originalCss;
  else delete require.extensions[".css"];
});
