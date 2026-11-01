import assert from "node:assert/strict";
import test from "node:test";

import { matchesRepairMemberKeyword } from "../../src/features/repairs/repair-member-search";

test("参与成员搜索命中展示名、姓名与昵称，并忽略前后空白", () => {
  const member = {
    id: "member-1",
    name: "小林",
    realName: "林晓",
    nickname: "小林",
  };
  assert.equal(matchesRepairMemberKeyword(member, "林晓"), true);
  assert.equal(matchesRepairMemberKeyword(member, "小林"), true);
  assert.equal(matchesRepairMemberKeyword(member, "  林  "), true);
  assert.equal(matchesRepairMemberKeyword(member, "王五"), false);
});

test("参与成员搜索不区分大小写，空关键字不命中", () => {
  const member = {
    id: "member-2",
    name: "Alice",
    realName: "Alice Zhang",
    nickname: "alice",
  };
  assert.equal(matchesRepairMemberKeyword(member, "ALICE"), true);
  assert.equal(matchesRepairMemberKeyword(member, "zhang"), true);
  assert.equal(matchesRepairMemberKeyword(member, "   "), false);
});

test("缺少姓名/昵称字段时仍按展示名匹配", () => {
  const member = { id: "member-3", name: "王五" };
  assert.equal(matchesRepairMemberKeyword(member, "王五"), true);
  assert.equal(matchesRepairMemberKeyword(member, "赵六"), false);
});

test("真名为空时仍可按昵称匹配，不把空值当作姓名", () => {
  const member = { id: "member-4", name: "旧昵称", realName: null, nickname: "旧昵称" };
  assert.equal(matchesRepairMemberKeyword(member, "旧昵称"), true);
  assert.equal(matchesRepairMemberKeyword(member, "林晓"), false);
  assert.equal(matchesRepairMemberKeyword(member, "null"), false);
});
