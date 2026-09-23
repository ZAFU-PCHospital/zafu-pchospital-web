import assert from "node:assert/strict";
import test from "node:test";

import { MAX_FILTER_RULES } from "../../src/lib/api/list-filter";
import type { FilterFieldOption } from "../../src/lib/table/field-spec";
import {
  addDraftRow,
  changeDraftField,
  changeDraftOp,
  changeDraftValue,
  draftFromRules,
  draftToRules,
  emptyDraft,
  isDraftComplete,
  removeDraftRow,
  type FilterDraftRow,
} from "../../src/lib/table/filter-draft";

/**
 * 列级筛选**草稿状态**的单元测试。
 *
 * 这里覆盖的是「弹层里点来点去会发生什么」：换列之后运算符怎么办、旧值留不留、
 * 什么时候「应用」该是灰的。这些判断全在 `lib/table/filter-draft.ts` 这层纯函数里，
 * 因此不需要 jsdom —— 项目没有装，测试用 `react-dom/server` 渲染，
 * 交互路径只能靠这一层兜住。
 */

const FIELDS: FilterFieldOption[] = [
  {
    key: "realName",
    columnKey: "member",
    label: "成员",
    ops: ["contains"],
    input: { kind: "text" },
  },
  {
    key: "status",
    columnKey: "status",
    label: "状态",
    ops: ["eq", "neq"],
    input: {
      kind: "enum",
      options: [
        { value: "ACTIVE", label: "在册" },
        { value: "REVOKED", label: "已停用" },
      ],
    },
  },
  {
    key: "joinedAt",
    columnKey: "joinedAt",
    label: "加入时间",
    ops: ["gte", "lte"],
    input: { kind: "date" },
  },
];

test("草稿是生效条件的副本，改草稿不影响已生效的条件", () => {
  const rules = [{ field: "realName", op: "contains", value: "张" } as const];
  const draft = draftFromRules(rules);
  assert.deepEqual(draft, [{ field: "realName", op: "contains", value: "张" }]);

  const changed = changeDraftValue(draft, 0, "李");
  assert.equal(changed[0]?.value, "李");
  // 原数组（也就是 `rules` 的拷贝）必须原样不动。
  assert.equal(draft[0]?.value, "张");

  // 空条件 → 空草稿，而不是预置一行空白。
  assert.deepEqual(draftFromRules([]), []);
  assert.deepEqual(emptyDraft(), []);
});

test("添加条件默认选第一列与它的第一个运算符，值留空", () => {
  const draft = addDraftRow(emptyDraft(), FIELDS);
  assert.deepEqual(draft, [{ field: "realName", op: "contains", value: "" }]);

  // 值必须由人填：默认给一个值反而会让人以为「不填就是筛这个」。
  assert.equal(draft[0]?.value, "");
});

test("到上限不再添加；没有可筛列时也加不出条件", () => {
  let draft = emptyDraft();
  for (let index = 0; index < MAX_FILTER_RULES; index += 1) {
    draft = addDraftRow(draft, FIELDS);
  }
  assert.equal(draft.length, MAX_FILTER_RULES);

  // 上限外的一次调用必须是**无动作**，而不是静默截断已有的条件。
  const overflow = addDraftRow(draft, FIELDS);
  assert.equal(overflow.length, MAX_FILTER_RULES);
  assert.notEqual(overflow, draft); // 新数组：React 才能看到变化

  assert.deepEqual(addDraftRow(emptyDraft(), []), []);
});

test("换列：新列不支持当前运算符就换成它的第一个", () => {
  const draft = [{ field: "realName", op: "contains", value: "张" } as const];
  const next = changeDraftField(draft, 0, "status", FIELDS);
  // 「包含」在状态列上不存在，必须换成「等于」，否则就是一条必然 400 的条件。
  assert.equal(next[0]?.op, "eq");
  assert.equal(next[0]?.field, "status");
});

test("换列：同样是文本框才留旧值，文本 ↔ 枚举 / 日期一律清空", () => {
  // 文本 → 枚举：选项完全不同，留着就是一条看着填了、提交必被拒的条件。
  const text = [{ field: "realName", op: "contains", value: "张" } as const];
  assert.equal(changeDraftField(text, 0, "status", FIELDS)[0]?.value, "");

  // 文本 → 日期：格式不同（`2026/1/1` 服务端不认），同样清空。
  assert.equal(changeDraftField(text, 0, "joinedAt", FIELDS)[0]?.value, "");

  // 日期 → 日期：形态相同，区间换条件时保留已经选好的那天，省一次重选。
  const date = [{ field: "joinedAt", op: "gte", value: "2026-01-01" } as const];
  const movedToLte = changeDraftField(date, 0, "joinedAt", FIELDS);
  assert.equal(movedToLte[0]?.value, "2026-01-01");

  // 枚举 → 枚举：选项因列而异，旧值在新列的选项里未必存在，因此一律清空。
  // （同一列不会触发 `onChange`，所以没有「枚举 → 同一枚举要不要留」这个问题。）
  const status = [{ field: "status", op: "eq", value: "ACTIVE" } as const];
  assert.equal(changeDraftField(status, 0, "status", FIELDS)[0]?.value, "");
});

test("换列 / 改值 / 删行都落在指定的一行上", () => {
  const draft = [
    { field: "realName", op: "contains", value: "张" },
    { field: "status", op: "eq", value: "ACTIVE" },
  ] as const;
  const changed = changeDraftValue(draft, 1, "REVOKED");
  assert.equal(changed[0]?.value, "张");
  assert.equal(changed[1]?.value, "REVOKED");

  const switchedOp = changeDraftOp(changed, 1, "neq");
  assert.equal(switchedOp[1]?.op, "neq");
  // 同一列的运算符共享一种值形态，因此改运算符不动已选的值。
  assert.equal(switchedOp[1]?.value, "REVOKED");

  const removed = removeDraftRow(switchedOp, 0);
  assert.deepEqual(removed, [{ field: "status", op: "neq", value: "REVOKED" }]);

  // 越界不该崩，也不该悄悄改动别的行（弹层里删到最后一行的瞬间会走到这条路径）。
  assert.deepEqual(updateOutOfRange(draft), [...draft]);
});

/** 越界的三条路径包一层，避免测试主体里出现三行几乎一样的断言。 */
function updateOutOfRange(draft: readonly FilterDraftRow[]) {
  return removeDraftRow(changeDraftValue(changeDraftOp(draft, 9, "contains"), 9, "x"), 9);
}

test("「应用」能不能点：每条都填完才行，空草稿可以（等于清空条件）", () => {
  // 空草稿是**合法**的应用：它就是「不要任何条件」，是清除筛选的那条路。
  assert.equal(isDraftComplete(emptyDraft()), true);

  const partial = [
    { field: "realName", op: "contains", value: "张" },
    { field: "status", op: "eq", value: "" },
  ] as const;
  assert.equal(isDraftComplete(partial), false);

  // 只有空格不算填了：否则会提交一条后端必然拒绝的空值条件。
  assert.equal(isDraftComplete([{ field: "realName", op: "contains", value: "   " }]), false);

  const filled = [
    { field: "realName", op: "contains", value: "张" },
    { field: "status", op: "eq", value: "ACTIVE" },
  ] as const;
  assert.equal(isDraftComplete(filled), true);
});

test("草稿转条件时去掉两边的空白", () => {
  const rules = draftToRules([{ field: "className", op: "contains", value: "  计算机  " }]);
  // `contains` 里的尾部空格是看不见的差异，却会让「明明匹配得上却搜不到」。
  assert.deepEqual(rules, [{ field: "className", op: "contains", value: "计算机" }]);
});
