import assert from "node:assert/strict";
import test from "node:test";
import { repairActivityStaffService } from "../../src/features/repair-activities/repair-activity-staff-service";
import type { AuthorizedActor } from "../../src/types/contracts";

const now = new Date("2026-10-26T06:00:00Z");
const activity = {
  id: "fixture",
  title: "隔离活动",
  activityAt: now,
  capacity: 100,
  signupOpensAt: new Date("2026-10-25T00:00:00Z"),
  signupClosesAt: new Date("2026-10-26T05:00:00Z"),
};
const registration = {
  id: "customer",
  activityId: "fixture",
  name: "隔离客户",
  phone: "13900000000",
  issueType: "CLEAN_ONLY",
  deviceModel: null,
  status: "SERVED",
  servedByMemberProfileId: "member",
  checkedInAt: now,
  servedAt: now,
  repairRecordId: null,
  createdAt: now,
  repairRecord: null,
};
function actor(admin: boolean): AuthorizedActor {
  return {
    actorType: "USER",
    userId: "user",
    userStatus: "ACTIVE",
    requestId: "isolated",
    permissions: admin ? ["activity:staff", "activity:admin"] : ["activity:staff"],
  };
}

test("增量 Service 的数据库边界：live 不读历史关系，served 按角色过滤，attendance 先授权", async (t) => {
  const queries: { model: string; operation: string; args: Record<string, unknown> }[] = [];
  const trace =
    (model: string, operation: string, result: unknown) =>
    async (args: Record<string, unknown>) => {
      queries.push({ model, operation, args });
      return result;
    };
  const attendanceRows = [
    {
      memberProfileId: "member",
      checkedInAt: now,
      memberProfile: {
        nickname: "隔离昵称",
        realName: "真实名夹具",
        user: { displayName: "显示名夹具" },
      },
    },
  ];
  const db = {
    memberProfile: { findFirst: trace("member", "findFirst", { id: "member" }) },
    repairActivity: { findFirst: trace("activity", "findFirst", activity) },
    repairActivityRegistration: {
      groupBy: trace("registration", "groupBy", [
        { status: "REGISTERED", _count: { _all: 2 } },
        { status: "SERVED", _count: { _all: 7 } },
      ]),
      findMany: trace("registration", "findMany", [registration]),
      findFirst: trace("registration", "findFirst", null),
      count: trace("registration", "count", 1),
    },
    repairActivityAttendance: {
      findUnique: trace("attendance", "findUnique", { checkedInAt: now }),
      count: trace("attendance", "count", 3),
      findMany: trace("attendance", "findMany", attendanceRows),
    },
  };
  const globalDb = globalThis as unknown as { __pcHospitalDb?: unknown };
  const previous = globalDb.__pcHospitalDb;
  globalDb.__pcHospitalDb = db;
  t.after(() => {
    globalDb.__pcHospitalDb = previous;
  });

  const adminLive = await repairActivityStaffService.getLiveBoard("fixture", actor(true));
  assert.equal(adminLive.servedCount, 7);
  assert.equal(adminLive.attendanceCount, 3);
  assert.equal("served" in adminLive, false);
  assert.equal("attendanceMembers" in adminLive, false);
  const liveRows = queries.find(
    (query) => query.model === "registration" && query.operation === "findMany",
  )!.args;
  assert.deepEqual(liveRows.where, {
    activityId: "fixture",
    deletedAt: null,
    status: { in: ["REGISTERED", "CHECKED_IN"] },
  });
  assert.equal("include" in liveRows, false);
  assert.equal("repairRecord" in (liveRows.select as object), false);
  assert.equal(
    queries.some((query) => query.model === "attendance" && query.operation === "findMany"),
    false,
  );

  queries.length = 0;
  const memberLive = await repairActivityStaffService.getLiveBoard("fixture", actor(false));
  assert.equal(memberLive.servedCount, 1, "成员不能显示全场已接待计数");
  assert.equal(memberLive.attendanceCount, null);
  assert.deepEqual(
    queries.find((query) => query.model === "registration" && query.operation === "findMany")!.args
      .where,
    { activityId: "fixture", deletedAt: null, status: "CHECKED_IN" },
  );
  assert.equal(
    queries.some((query) => query.model === "attendance" && query.operation === "count"),
    false,
  );
  assert.equal(
    queries.some((query) => query.model === "attendance" && query.operation === "findMany"),
    false,
  );

  queries.length = 0;
  const served = await repairActivityStaffService.getServedBoard("fixture", actor(false));
  assert.deepEqual(
    queries.find((query) => query.model === "registration" && query.operation === "findMany")!.args
      .where,
    { activityId: "fixture", deletedAt: null, status: "SERVED", servedByMemberProfileId: "member" },
  );
  assert.equal(served.served[0].canFill, true);
  assert.equal("servedByName" in served.served[0], false);
  assert.equal(served.served[0].phoneMasked, "139****0000");
  assert.equal(JSON.stringify(served).includes("13900000000"), false);

  queries.length = 0;
  await assert.rejects(
    () => repairActivityStaffService.getAttendanceBoard("fixture", actor(false)),
    (error: unknown) => (error as { code: string }).code === "FORBIDDEN",
  );
  assert.equal(queries.length, 0, "成员在名单查询前拒绝");
  const attendance = await repairActivityStaffService.getAttendanceBoard("fixture", actor(true));
  assert.deepEqual(attendance.attendanceMembers, [
    { memberProfileId: "member", name: "隔离昵称", checkedInAt: now.toISOString() },
  ]);
});

test("已接待姓名：管理员取实际接待者姓名，兼容待补建与缺失资料；成员不查询或接收姓名", async (t) => {
  const rows = [
    {
      ...registration,
      servedBy: { realName: "接待者姓名", nickname: "接待者昵称" },
    },
    {
      ...registration,
      id: "submitted",
      servedAt: new Date(now.getTime() - 1000),
      servedByMemberProfileId: "other-member",
      servedBy: { realName: "另一接待者", nickname: "另一昵称" },
      repairRecordId: "record",
      repairRecord: { id: "record", status: "PENDING", submittedAt: now, deletedAt: null },
    },
    {
      ...registration,
      id: "missing-member",
      servedAt: new Date(now.getTime() - 2000),
      servedByMemberProfileId: null,
      servedBy: null,
    },
    {
      ...registration,
      id: "empty-name",
      servedAt: new Date(now.getTime() - 3000),
      servedBy: { realName: "  ", nickname: "不可用昵称兜底" },
    },
  ];
  const queries: Record<string, unknown>[] = [];
  const globalDb = globalThis as unknown as { __pcHospitalDb?: unknown };
  const previous = globalDb.__pcHospitalDb;
  globalDb.__pcHospitalDb = {
    memberProfile: { findFirst: async () => ({ id: "member" }) },
    repairActivity: { findFirst: async () => activity },
    repairActivityRegistration: {
      findMany: async (args: Record<string, unknown>) => {
        queries.push(args);
        return rows;
      },
      findFirst: async () => null,
      count: async () => rows.length,
    },
    repairActivityAttendance: {
      findUnique: async () => null,
      findMany: async () => [],
    },
  };
  t.after(() => {
    globalDb.__pcHospitalDb = previous;
  });

  for (const method of ["getBoard", "getServedBoard"] as const) {
    const adminBoard = await repairActivityStaffService[method]("fixture", actor(true));
    assert.deepEqual(
      adminBoard.served.map((row) => [row.id, row.servedByName]),
      [
        ["customer", "接待者姓名"],
        ["submitted", "另一接待者"],
        ["missing-member", null],
        ["empty-name", null],
      ],
    );
    assert.equal(adminBoard.served[0].repairRecordId, null, "待补建也返回接待者姓名");
    assert.equal(adminBoard.served[1].recordStatus, "PENDING");
    assert.deepEqual((queries.at(-1)!.include as Record<string, unknown>).servedBy, {
      select: { realName: true },
    });
    assert.equal(JSON.stringify(adminBoard.served).includes("昵称"), false);

    const memberBoard = await repairActivityStaffService[method]("fixture", actor(false));
    assert.deepEqual(
      memberBoard.served.map((row) => row.id),
      ["customer", "empty-name"],
    );
    assert.ok(memberBoard.served.every((row) => !("servedByName" in row)));
    assert.equal((queries.at(-1)!.include as Record<string, unknown>).servedBy, false);
    assert.equal(JSON.stringify(memberBoard.served).includes("接待者姓名"), false);
  }
});
