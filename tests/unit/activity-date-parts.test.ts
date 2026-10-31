import assert from "node:assert/strict";
import test from "node:test";

import { formatShanghaiDateParts } from "../../src/components/repair-activities/activity-format";

test("日期票根按 Asia/Shanghai 拆分月份、日与星期", () => {
  assert.deepEqual(formatShanghaiDateParts("2026-10-31T01:00:00.000Z"), {
    month: "10月",
    day: "31",
    weekday: "周六",
  });
});

test("日期票根跨上海午夜后取次日，日补零", () => {
  assert.deepEqual(formatShanghaiDateParts("2026-10-31T16:30:00.000Z"), {
    month: "11月",
    day: "01",
    weekday: "周日",
  });
});

test("日期票根补零单个数字日，单位数月份不补零", () => {
  assert.deepEqual(formatShanghaiDateParts("2026-11-05T04:00:00.000Z"), {
    month: "11月",
    day: "05",
    weekday: "周四",
  });
  assert.deepEqual(formatShanghaiDateParts("2026-01-09T04:00:00.000Z"), {
    month: "1月",
    day: "09",
    weekday: "周五",
  });
});
