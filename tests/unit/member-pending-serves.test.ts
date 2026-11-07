import assert from "node:assert/strict";
import test from "node:test";

import { elements, text } from "../support/react-client";
import { MemberPendingServes } from "../../src/components/member/MemberPendingServes";

test("工作台待补单卡片展示本人记录并链接到预填维修表单", () => {
  const tree = MemberPendingServes({
    items: [
      {
        registrationId: "registration-1",
        name: "张三",
        activityId: "activity-1",
        activityTitle: "秋季义务维修",
        activityAt: "2026-10-15T04:00:00.000Z",
      },
    ],
  });

  const links = elements(tree, (element) => typeof element.props.href === "string");
  assert.equal(links.length, 1);
  assert.equal(
    links[0].props.href,
    "/member/repairs/new?activityId=activity-1&registrationId=registration-1",
  );

  const content = text(tree);
  assert.ok(content.includes("接待待补单"));
  assert.ok(content.includes("张三"));
  assert.ok(content.includes("秋季义务维修"));
  assert.ok(content.includes("活动时间"));
  assert.ok(content.includes("继续填写：张三，秋季义务维修"));
});
