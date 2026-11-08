import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATTENDED_TAG_CLASS,
  recordStatusTagClass,
} from "../../src/components/repair-activities/activity-record-tag";

const read = (path: string) => readFileSync(path, "utf8");
const css = () => read("src/app/globals.css");

test("成员看板标签配色（issue #368）：待审核不再与待补建撞成同一档警示橙", () => {
  // 待补建仍是警示橙（公共类 `--pending`，后台招募列表与公开 FULL 标签共用）。
  assert.ok(
    read("src/components/repair-activities/MemberRepairActivityBoard.tsx").includes(
      'className="repair-tag repair-tag--pending"',
    ),
    "待补建应继续使用公共的 --pending",
  );
  // 待审核改品牌色，不再落到 `--pending`。
  const pending = recordStatusTagClass("PENDING");
  assert.equal(pending, "repair-tag repair-tag--review");
  assert.equal(pending.includes("repair-tag--pending"), false);
  // 其余状态档位不变。
  assert.equal(recordStatusTagClass("DRAFT"), "repair-tag repair-tag--draft");
  assert.equal(recordStatusTagClass("APPROVED"), "repair-tag repair-tag--approved");
  assert.equal(recordStatusTagClass("REJECTED"), "repair-tag repair-tag--rejected");
  // 未知状态回落到中性档，不拼出不存在的类名。
  assert.equal(recordStatusTagClass("SOMETHING_NEW"), "repair-tag repair-tag--draft");
});

test("成员看板标签配色（issue #368）：你已出勤改用成功色，不再与待审核同色", () => {
  assert.equal(ATTENDED_TAG_CLASS, "admin-tag admin-tag--served");
  assert.equal(ATTENDED_TAG_CLASS.includes("admin-tag--accent"), false);
  // 三种状态两两不同类（绿 / 橙 / 品牌色）。
  const classes = new Set([
    ATTENDED_TAG_CLASS,
    "repair-tag repair-tag--pending",
    recordStatusTagClass("PENDING"),
  ]);
  assert.equal(classes.size, 3);
});

test("新修饰类只用既有令牌，不改公共类定义", () => {
  const source = css();
  const block = (selector: string) => {
    const start = source.indexOf(`${selector} {`);
    assert.ok(start >= 0, `缺少 ${selector}`);
    return source.slice(start, source.indexOf("}", start));
  };

  const served = block(".admin-tag--served");
  assert.ok(served.includes("var(--status-success-line)"));
  assert.ok(served.includes("var(--status-success-wash)"));
  assert.ok(served.includes("var(--status-success-deep)"));

  const review = block(".repair-tag--review");
  assert.ok(review.includes("var(--accent-line)"));
  assert.ok(review.includes("var(--accent-wash)"));
  assert.ok(review.includes("var(--accent-deep)"));

  // 两个新类不得出现硬编码色值（只允许 var(--token)）。
  for (const blockText of [served, review]) {
    assert.equal(/#[0-9a-f]{3,8}\b/i.test(blockText), false, "不得硬编码十六进制色值");
    assert.equal(/rgb\(|oklch\(/i.test(blockText), false, "不得硬编码色值函数");
  }

  // 公共类 `--pending` 仍是警示橙三件套，未被顺手改掉。
  const pending = block(".repair-tag--pending");
  assert.ok(pending.includes("var(--status-warning-line)"));
  assert.ok(pending.includes("var(--status-warning-wash)"));
  assert.ok(pending.includes("var(--status-warning-deep)"));
});

test("看板接线：使用共享映射，不再拼 `repair-tag--${status}`", () => {
  const board = read("src/components/repair-activities/MemberRepairActivityBoard.tsx");
  assert.ok(board.includes("recordStatusTagClass(row.recordStatus)"));
  assert.ok(board.includes("{ATTENDED_TAG_CLASS}"));
  assert.equal(board.includes("repair-tag--${row.recordStatus.toLowerCase()}"), false);
});
