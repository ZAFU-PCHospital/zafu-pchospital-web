import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { memberService } from "../../src/features/members/member-service";
import { MAX_FILTER_RULES, type FilterRule } from "../../src/lib/api/list-filter";
import { listQueryParams } from "../../src/lib/api/list-query";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor, MemberListEntry } from "../../src/types/contracts";

import { callRoute, sessionCookie } from "./http-harness";
import { integrationTestsEnabled } from "./db-guard";

/**
 * 列级筛选的**闭环**集成测试：构造数据 → 真实 HTTP 路由 → 真实数据库。
 *
 * 与 `member-filter.test.ts` 的分工：那个文件直接调 `memberService.list`，覆盖的是
 * 「条件 → where」；这里从头走一遍完整链路，包括三处以前没有测试守着的接缝：
 *
 * 1. **UI 拼出来的查询串**：用 `listQueryParams` —— 面板用的就是它，因此这里断言的
 *    是「面板真实发出的那串字节」，而不是测试自己另拼一份（那样两边可能各自漂移）；
 * 2. **路由的参数解析**：`filter=` 的重复参数由 `member-http.ts` 取 `getAll("filter")`
 *    再解析，白名单校验在这一层，越权字段必须 400 而不是透传成列名；
 * 3. **鉴权 + 信封**：带真实会话 Cookie 请求，断言 `success / data / meta.pagination`。
 *
 * 数据是**专门构造**的，每个条件都有「该命中」与「不该命中」两边（只断言命中数会把
 * 「筛选没生效」也判成通过的部分情况漏过去）：
 *
 * | 成员 | 学号     | 班级          | 昵称 | 状态   |
 * | ---- | -------- | ------------- | ---- | ------ |
 * | 甲A  | M10A2023 | M10 计科:2101 | 小甲 | ACTIVE |
 * | 乙B  | M10B2023 | M10 计科:2101 | 小乙 | ACTIVE |
 * | 丙C  | M10C2024 | M10 软工2202  | 小丙 | ACTIVE |
 * | 丁D  | M10D2024 | M10 软工2202  | 小丁 | 已停用 |
 *
 * 班级里那个**冒号是故意的**：`filter` 的值允许带冒号（只切前两个），
 * 这是「不自己发明转义规则」那条设计的实测点。
 */
/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

const ACTOR_USER_ID = "eb000000-0000-4000-8000-000000000001";
const PREFIX = "M10 ";

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: ACTOR_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m10_filter_http",
};

let cookie = "";

/** 上海自然日 `YYYY-MM-DD`（与 `lib/api/date-filter.ts` 同一口径）。 */
function shanghaiDay(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(at);
}

before(async () => {
  if (!enabled) return;
  await cleanup();
  const now = new Date();
  await getDb().user.create({
    data: {
      id: ACTOR_USER_ID,
      status: "ACTIVE",
      displayName: "M10 Filter Admin",
      createdAt: now,
      updatedAt: now,
    },
  });
  await getDb().passwordCredential.create({
    data: {
      userId: ACTOR_USER_ID,
      passwordHash: "scrypt$placeholder",
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  cookie = await sessionCookie(ACTOR_USER_ID, "ADMIN");
  // **只造一次**：下面每个断言都按「恰好这四个人」来数（每个用例各造一次会让成员越积
  // 越多，断言就会莫名其妙地失败 —— 这个坑在 `member-filter.test.ts` 里踩过）。
  await seed();
});

after(async () => {
  if (!enabled) return;
  await cleanup();
  await disconnectDb();
});

async function cleanup(): Promise<void> {
  const db = getDb();
  const profiles = await db.memberProfile.findMany({
    where: { realName: { startsWith: PREFIX } },
    select: { id: true, userId: true },
  });
  const profileIds = profiles.map((row) => row.id);
  const userIds = [...new Set([ACTOR_USER_ID, ...profiles.map((row) => row.userId)])];
  await db.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: [...userIds, ...profileIds] } }],
    },
  });
  await db.accountProvision.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { memberProfileId: { in: profileIds } }] },
  });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.userSkill.deleteMany({ where: { memberProfileId: { in: profileIds } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profileIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

let seq = 0;
async function createMember(fields: {
  label: string;
  studentId: string;
  className: string;
  nickname: string;
}): Promise<{ id: string }> {
  seq += 1;
  const serial = `${Date.now()}`.slice(-5) + String(seq).padStart(3, "0");
  const result = await memberService.create(
    {
      realName: `${PREFIX}${fields.label}`,
      qq: `8${serial}`.slice(0, 11),
      phone: `137${serial}`.slice(0, 11),
      studentId: fields.studentId,
      className: fields.className,
      nickname: fields.nickname,
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  return result.member;
}

async function seed(): Promise<void> {
  await createMember({
    label: "甲A",
    studentId: "M10A2023",
    className: "M10 计科:2101",
    nickname: "小甲",
  });
  await createMember({
    label: "乙B",
    studentId: "M10B2023",
    className: "M10 计科:2101",
    nickname: "小乙",
  });
  await createMember({
    label: "丙C",
    studentId: "M10C2024",
    className: "M10 软工2202",
    nickname: "小丙",
  });
  const revoked = await createMember({
    label: "丁D",
    studentId: "M10D2024",
    className: "M10 软工2202",
    nickname: "小丁",
  });
  // 停用一个人：状态列的 `eq` 与 `neq` 两边都要有命中与不命中。
  await memberService.batchSetEnabled({ memberIds: [revoked.id], enabled: false }, ADMIN_ACTOR);
}

/** 一次路由级列表查询；参数由**面板用的那个函数**拼出来。 */
async function listVia(options: {
  filters?: FilterRule[];
  query?: string;
  fixed?: Record<string, string | undefined>;
}): Promise<{
  status: number;
  total: number;
  names: string[];
  code: string | undefined;
  requestId: unknown;
}> {
  const { GET } = await import("../../src/app/api/v1/admin/members/route");
  const params = listQueryParams(
    // 排序留空：这条用例测的是筛选参数，排序由 `member-sort.test.ts` 覆盖。
    { page: 1, pageSize: 20, query: options.query, sort: [] },
    { fixed: options.fixed, filters: options.filters },
  );
  const result = await callRoute(GET, `http://localhost/api/v1/admin/members?${params}`, {
    headers: { cookie },
  });
  const items = (result.json.data as MemberListEntry[] | undefined) ?? [];
  const meta = result.json.meta as { requestId?: unknown; pagination?: { total: number } };
  return {
    status: result.status,
    total: meta.pagination?.total ?? 0,
    names: items.map((item) => item.realName),
    code: (result.json.error as { code?: string } | undefined)?.code,
    requestId: meta.requestId,
  };
}

/** 与库里的排序无关地比人名集合（服务端的并列名次顺序不在这条契约里）。 */
const sortedNames = (names: readonly string[]) =>
  [...names].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

dbTest("基线：构造出来的四个成员都在，且未筛选时一个不少", async () => {
  const all = await listVia({ query: PREFIX.trim() });
  assert.equal(all.status, 200);
  assert.equal(all.total, 4);
  assert.deepEqual(
    sortedNames(all.names),
    sortedNames(["M10 甲A", "M10 乙B", "M10 丙C", "M10 丁D"]),
  );
  assert.equal(typeof all.requestId, "string", "成功响应也要带 requestId");
});

dbTest("文本条件：学号 contains 命中该年段的人，不命中的一个不多", async () => {
  const older = await listVia({
    filters: [{ field: "studentId", op: "contains", value: "2023" }],
    query: PREFIX.trim(),
  });
  assert.equal(older.status, 200);
  assert.equal(older.total, 2);
  assert.deepEqual(sortedNames(older.names), sortedNames(["M10 甲A", "M10 乙B"]));

  const newer = await listVia({
    filters: [{ field: "studentId", op: "contains", value: "2024" }],
    query: PREFIX.trim(),
  });
  assert.deepEqual(sortedNames(newer.names), sortedNames(["M10 丙C", "M10 丁D"]));
});

dbTest("值是用户输入：班级名里的冒号不会被当成参数分隔符", async () => {
  // `filter=className:contains:M10 计科:2101` —— 解析只切**前两个**冒号，剩下整段是值。
  // 若哪天改成 split(":")，这条会红。
  const withColon = await listVia({
    filters: [{ field: "className", op: "contains", value: "M10 计科:2101" }],
  });
  assert.equal(withColon.status, 200);
  assert.equal(withColon.total, 2);
  assert.deepEqual(sortedNames(withColon.names), sortedNames(["M10 甲A", "M10 乙B"]));

  const partial = await listVia({
    filters: [{ field: "className", op: "contains", value: "软工" }],
  });
  assert.equal(partial.total, 2);
  assert.deepEqual(sortedNames(partial.names), sortedNames(["M10 丙C", "M10 丁D"]));
});

dbTest("姓名与昵称两列各筛各的（成员首列的后端字段是 realName）", async () => {
  const byName = await listVia({
    filters: [{ field: "realName", op: "contains", value: "丙" }],
  });
  assert.equal(byName.total, 1);
  assert.deepEqual(byName.names, ["M10 丙C"]);

  // 昵称在后端白名单里、界面暂时没有入口（它跟姓名同一格显示，用关键字搜索更快）。
  // 这一条把「后端支持」这件事钉住：将来给昵称开入口时不必再改后端。
  const byNickname = await listVia({
    filters: [{ field: "nickname", op: "contains", value: "小丁" }],
  });
  assert.equal(byNickname.total, 1);
  assert.deepEqual(byNickname.names, ["M10 丁D"]);
});

dbTest("枚举条件：eq 与 neq 各命中一边（含一个已停用成员）", async () => {
  const active = await listVia({
    filters: [{ field: "status", op: "eq", value: "ACTIVE" }],
    query: PREFIX.trim(),
  });
  assert.equal(active.total, 3);
  assert.deepEqual(sortedNames(active.names), sortedNames(["M10 甲A", "M10 乙B", "M10 丙C"]));

  const revoked = await listVia({
    filters: [{ field: "status", op: "neq", value: "ACTIVE" }],
    query: PREFIX.trim(),
  });
  assert.equal(revoked.total, 1);
  assert.deepEqual(revoked.names, ["M10 丁D"]);
});

dbTest("日期条件：区间闭到当天全天，昨天及以前不包含今天创建的人", async () => {
  const today = shanghaiDay();

  const upToToday = await listVia({
    filters: [{ field: "joinedAt", op: "lte", value: today }],
    query: PREFIX.trim(),
  });
  assert.equal(
    upToToday.total,
    4,
    "实现若把上界取成「当天 00:00」，就会漏掉当天之后创建的记录 —— 界面上表现为「筛同一天得到 0 条」",
  );

  const interval = await listVia({
    filters: [
      { field: "joinedAt", op: "gte", value: today },
      { field: "joinedAt", op: "lte", value: today },
    ],
    query: PREFIX.trim(),
  });
  assert.equal(interval.total, 4, "同一天的闭区间（两条条件）应命中当天创建的全部记录");

  const upToYesterday = await listVia({
    filters: [{ field: "joinedAt", op: "lte", value: shanghaiDay(-1) }],
    query: PREFIX.trim(),
  });
  assert.equal(upToYesterday.total, 0);
});

dbTest("多列条件是 AND：两个条件一起把结果收窄", async () => {
  // 只按班级：同班两个人（甲A、乙B）。
  const classOnly = await listVia({
    filters: [{ field: "className", op: "contains", value: "计科" }],
  });
  assert.equal(classOnly.total, 2);
  assert.deepEqual(sortedNames(classOnly.names), sortedNames(["M10 甲A", "M10 乙B"]));

  // 再加一条学号：只剩甲A。与上一条对照，才能说明这两个条件**都在生效** ——
  // 只断言「结果是 1」的话，其中一个条件被忽略也可能碰巧是 1。
  const both = await listVia({
    filters: [
      { field: "className", op: "contains", value: "计科" },
      { field: "studentId", op: "contains", value: "M10A" },
    ],
  });
  assert.equal(both.total, 1);
  assert.deepEqual(both.names, ["M10 甲A"]);

  // 再加一条不可能满足的：AND 链上任一条不成立就必须是 0，而不是被忽略。
  const impossible = await listVia({
    filters: [
      { field: "className", op: "contains", value: "计科" },
      { field: "status", op: "eq", value: "REVOKED" },
    ],
  });
  assert.equal(impossible.total, 0);
});

dbTest("三种筛选同时生效：关键字 + 快捷筛选 + 列级条件", async () => {
  const combined = await listVia({
    query: "甲",
    fixed: { status: "ACTIVE" },
    filters: [{ field: "studentId", op: "contains", value: "2023" }],
  });
  assert.equal(combined.status, 200);
  assert.equal(combined.total, 1);
  assert.deepEqual(combined.names, ["M10 甲A"]);

  // 同样的列级条件，把快捷筛选换成「已停用」就该是 0 —— 证明快捷筛选没有被列级条件盖掉。
  const mismatch = await listVia({
    query: "甲",
    fixed: { status: "REVOKED" },
    filters: [{ field: "studentId", op: "contains", value: "2023" }],
  });
  assert.equal(mismatch.total, 0);
});

dbTest("列级条件与排序可以同时用（面板里两者并存）", async () => {
  const sorted = await listVia({
    filters: [{ field: "className", op: "contains", value: "计科" }],
  });
  assert.equal(sorted.status, 200);
  assert.equal(sorted.total, 2);
  // 排序本身由 `member-sort.test.ts` 覆盖；这里只确认两套参数在同一串里不打架。
  assert.deepEqual(sortedNames(sorted.names), sortedNames(["M10 甲A", "M10 乙B"]));
});

dbTest("非法条件一律 400 VALIDATION_FAILED，绝不透传成列名", async () => {
  const cases: { why: string; filters: FilterRule[] }[] = [
    // 白名单外的字段（qq 是联系方式，不在 MEMBER_FILTERABLE 里）。
    { why: "字段不在白名单", filters: [{ field: "qq", op: "contains", value: "1" }] },
    // 白名单内但不支持这个运算符：学号只开放 contains。
    { why: "运算符不被该列支持", filters: [{ field: "studentId", op: "eq", value: "M10A2023" }] },
    // 空值（只有空格）等于没筛，却会让界面上多出一条看着生效的条件。
    { why: "值为空", filters: [{ field: "studentId", op: "contains", value: "   " }] },
    // 枚举取值不在 MemberStatus 里。
    { why: "枚举取值非法", filters: [{ field: "status", op: "eq", value: "UNKNOWN" }] },
    // 日期格式不对。
    { why: "日期格式非法", filters: [{ field: "joinedAt", op: "gte", value: "2026/01/01" }] },
    // 超过条数上限：拒绝而不是截断（截断会让使用者以为第五条也在生效）。
    {
      why: `超过 ${MAX_FILTER_RULES} 条`,
      filters: Array.from({ length: MAX_FILTER_RULES + 1 }, () => ({
        field: "studentId",
        op: "contains" as const,
        value: randomUUID().slice(0, 4),
      })),
    },
  ];

  for (const item of cases) {
    const result = await listVia({ filters: item.filters });
    assert.equal(result.status, 400, `${item.why} 应当 400`);
    assert.equal(result.code, "VALIDATION_FAILED", `${item.why} 的错误码`);
    assert.equal(result.total, 0);
  }
});

dbTest("格式不对的 filter 参数：400，而不是当成「没有条件」静默放过", async () => {
  const { GET } = await import("../../src/app/api/v1/admin/members/route");
  const bad = await callRoute(
    GET,
    "http://localhost/api/v1/admin/members?page=1&pageSize=20&filter=studentId",
    { headers: { cookie } },
  );
  assert.equal(bad.status, 400);
  assert.equal((bad.json.error as { code: string }).code, "VALIDATION_FAILED");
});
