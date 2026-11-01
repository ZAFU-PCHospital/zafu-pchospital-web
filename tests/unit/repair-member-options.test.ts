import assert from "node:assert/strict";
import test from "node:test";

import { matchesRepairMemberKeyword } from "../../src/features/repairs/repair-member-search";
import { listRepairMemberOptions } from "../../src/features/repairs/repair-query-service";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { AuthorizedActor } from "../../src/types/contracts";

test("全局维修候选保留姓名与昵称，接口结果可直接用于双字段搜索", async (t) => {
  const rows = [
    { id: "member-1", realName: "林晓", nickname: "小林", user: { displayName: "账号甲" } },
    { id: "member-2", realName: "Alice Zhang", nickname: "AZ", user: { displayName: null } },
    { id: "member-3", realName: "𠮷田", nickname: null, user: { displayName: null } },
    { id: "member-4", realName: "", nickname: "旧昵称", user: { displayName: null } },
  ];
  const actor: AuthorizedActor = {
    actorType: "USER",
    userId: "actor-user",
    userStatus: "ACTIVE",
    requestId: "repair-member-options-test",
    permissions: ["repair:read"],
  };
  const globals = globalThis as typeof globalThis & { __pcHospitalDb?: PrismaClient };
  const previousDb = globals.__pcHospitalDb;
  globals.__pcHospitalDb = {
    memberProfile: {
      findFirst: async () => ({ id: "actor-member" }),
      findMany: async () => rows,
    },
  } as unknown as PrismaClient;
  t.after(() => {
    globals.__pcHospitalDb = previousDb;
  });

  const options = await listRepairMemberOptions(actor);
  assert.deepEqual(options[0], {
    id: "member-1",
    name: "小林",
    realName: "林晓",
    nickname: "小林",
  });
  for (const [keyword, expectedIds] of [
    ["林晓", ["member-1"]],
    [" 林 ", ["member-1"]],
    ["小林", ["member-1"]],
    ["小", ["member-1"]],
    ["alice zhang", ["member-2"]],
    ["ZHANG", ["member-2"]],
    ["az", ["member-2"]],
    ["𠮷", ["member-3"]],
    ["旧昵称", ["member-4"]],
    ["不存在", []],
    ["   ", []],
  ] as const) {
    assert.deepEqual(
      options
        .filter((option) => matchesRepairMemberKeyword(option, keyword))
        .map((option) => option.id),
      expectedIds,
      keyword,
    );
  }
  assert.equal(options[2].name, "𠮷田", "没有昵称时仍以姓名展示");
  for (const option of options) {
    assert.deepEqual(Object.keys(option).sort(), ["id", "name", "nickname", "realName"]);
  }
});
