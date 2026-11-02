import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("成员端状态文案接线（issue #239）：列表 / 工作台用成员文案，公开页保持公开文案", () => {
  const memberList = read("src/components/repair-activities/MemberRepairActivityList.tsx");
  const memberCard = read("src/components/repair-activities/MemberRepairActivityTicketCard.tsx");
  const memberBoard = read("src/components/repair-activities/MemberRepairActivityBoard.tsx");
  const publicList = read("src/components/repair-activities/RepairActivityList.tsx");
  const publicCard = read("src/components/repair-activities/ActivityTicketCard.tsx");
  const publicDetail = read("src/components/repair-activities/RepairActivityDetail.tsx");

  for (const source of [memberCard, memberBoard]) {
    assert.ok(source.includes("memberRepairActivityStatusLabels"));
    assert.equal(source.includes("repairActivityStatusLabels"), false);
  }
  assert.ok(memberList.includes("MemberRepairActivityTicketCard"));
  assert.ok(memberCard.includes("memberRepairActivityStatusBadgeClass(activity.status)"));
  assert.ok(memberCard.includes("ActivityTicketCardShell"));
  assert.ok(memberCard.includes("/member/repair-activities/"));
  assert.ok(memberBoard.includes("memberRepairActivityStatusBadgeClass(status)"));
  assert.ok(publicList.includes("ActivityTicketCard"));
  assert.ok(
    publicCard.includes("repairActivityStatusLabels[activity.status as RepairActivityStatus]"),
  );
  assert.ok(
    publicDetail.includes("repairActivityStatusLabels[activity.status as RepairActivityStatus]"),
  );
});
