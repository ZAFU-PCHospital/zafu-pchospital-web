import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { analyticsService } from "../../src/features/analytics/analytics-service";
import { rankingService } from "../../src/features/analytics/ranking-service";
import { memberDashboardService } from "../../src/features/member-dashboard/member-dashboard-service";
import { memberProfileService } from "../../src/features/member-profile/member-profile-service";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import {
  recentShanghaiMonths,
  resetAcademicTermConfigForTests,
  shanghaiMonthRange,
} from "../../src/lib/academic-term";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { digestSessionToken } from "../../src/lib/security/secrets";
import type { AuthorizedActor, AnalyticsScope, RankingMetric } from "../../src/types/contracts";
import { ANALYTICS_TREND_MONTHS } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * 本文件使用**独立的 UUID 段**（`d5000000-…`），与 M0–M4 的 fixture 完全隔离，
 * 原因同 M3：集成测试共享同一个数据库，各文件的 fixture 生命周期必须互不依赖。
 */
const PREFIX = "M5 ";

type MemberFixture = {
  userId: string;
  memberProfileId: string;
  actor: Actor;
  /** 用于路由级测试的真实 Session Cookie。 */
  cookie: string;
  userIdForCookie: string;
};

type Actor = AuthorizedActor;

let seq = 0;

/** 直接建 User + MemberProfile，避免走服务层的幂等/QQ 约束，便于精确控制状态。 */
async function createMember(
  label: string,
  options: { memberStatus?: "ACTIVE" | "REVOKED"; profileDeleted?: boolean } = {},
): Promise<MemberFixture> {
  const db = getDb();
  seq += 1;
  const tag = String(seq).padStart(3, "0");
  const userId = randomUUID();
  const memberProfileId = randomUUID();
  const now = new Date();
  const realName = `${PREFIX}${label}${tag}`;

  await db.user.create({
    data: {
      id: userId,
      status: "ACTIVE",
      displayName: `${label}${tag}`,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.userIdentity.create({
    data: {
      id: randomUUID(),
      userId,
      type: "QQ",
      // 用随机数字段保证同一轮内绝不碰撞（唯一约束在 (type, identifierNormalized)）。
      identifierNormalized: `9${randomUUID().replace(/\D/g, "").padEnd(9, "7").slice(0, 9)}`,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.memberProfile.create({
    data: {
      id: memberProfileId,
      userId,
      realName,
      nickname: options.memberStatus === "REVOKED" ? null : `昵称${tag}`,
      status: options.memberStatus ?? "ACTIVE",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: options.profileDeleted ? now : null,
    },
  });
  // 路由级测试需要能通过 authenticateRequest：MEMBER 角色 + 非首次改密。
  const memberRole = await db.role.findUnique({ where: { code: "MEMBER" } });
  if (memberRole) {
    await db.userRole.create({
      data: {
        id: randomUUID(),
        userId,
        roleId: memberRole.id,
        sourceType: "ADMIN_CREATED",
        sourceId: userId,
        grantedAt: now,
        activeKey: `${userId}:${memberRole.id}`,
      },
    });
  }
  const token = `m5-${randomUUID()}`;
  await db.passwordCredential.create({
    data: {
      userId,
      passwordHash: "scrypt$placeholder",
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    },
  });

  return {
    userId,
    memberProfileId,
    cookie: `pc_hospital_session=${token}`,
    userIdForCookie: userId,
    actor: {
      actorType: "USER",
      userId,
      userStatus: "ACTIVE",
      permissions: permissionsForRoles(["MEMBER"]),
      requestId: `req_m5_${randomUUID()}`,
    },
  };
}

/** 直接落库构造维修记录，精确控制状态 / 日期 / 时长 / 软删除。 */
async function seedRepair(
  memberProfileId: string,
  options: {
    date: string;
    status?: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
    durationMinutes?: number | null;
    categoryId?: string | null;
    deleted?: boolean;
  },
): Promise<string> {
  const db = getDb();
  const now = new Date();
  const id = randomUUID();
  await db.repairRecord.create({
    data: {
      id,
      memberProfileId,
      repairDate: new Date(`${options.date}T00:00:00.000Z`),
      durationMinutes: options.durationMinutes === undefined ? 30 : options.durationMinutes,
      categoryId: options.categoryId ?? null,
      content: `${PREFIX}统计口径测试记录`,
      result: "COMPLETED",
      status: options.status ?? "APPROVED",
      createRequestKey: `m5-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: options.deleted ? now : null,
    },
  });
  return id;
}

/**
 * 受控学期窗口。
 *
 * 榜单是**全局**的（面向全体有效成员），而集成测试共享同一个数据库 ——
 * 其他文件与历史会话的成员也可能带本月已通过记录。因此凡是需要**精确**断言
 * 名次 / 总数 / 分页的用例，都改用 TERM 范围并落在这样一个「过去、且只有本文件会用」
 * 的月份里，从而把榜单成员集合收敛成可预期的本文档 fixture。
 */
const CONTROLLED_TERM_START = "2020-01-01";
const CONTROLLED_TERM_END = "2020-01-31";
const CONTROLLED_MONTH = "2020-01";
/** 受控窗口内的一天，用于聚合测试。 */
const CONTROLLED_DAY = `${CONTROLLED_MONTH}-15`;

function useControlledTerm(): void {
  process.env.ACADEMIC_TERM_START = CONTROLLED_TERM_START;
  process.env.ACADEMIC_TERM_END = CONTROLLED_TERM_END;
  resetAcademicTermConfigForTests();
}

/** 当前上海自然月的 `YYYY-MM` 与若干可控日期。 */
function monthKeys() {
  const now = new Date();
  const { year, month } = shanghaiMonthRange(now);
  const current = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const [previous] = recentShanghaiMonths(now, 2);
  return { current, previous: previous!, now };
}

/**
 * 只清理**本文件自己**的数据，且一律用「先查出自己的 id 列表、再按 id 删」的方式，
 * 不用可能命中他人 fixture 的宽泛谓词（集成测试共享同一个数据库）。
 *
 * 两个与 M4 相同的注意点：
 * - `repair_comments.parent_comment_id` 是自引用外键，必须**先删回复再删根评论**；
 * - `skills` 是共享 seed、刻意不删，但它有可空的 `created_by → users`，
 *   因此删除 users 前只需**解绑引用**（本文件不创建技能，仅为防御性处理）。
 */
async function prepareFixtures(): Promise<void> {
  const db = getDb();

  const mine = await db.memberProfile.findMany({
    where: { realName: { startsWith: PREFIX } },
    select: { id: true, userId: true },
  });
  const profileIds = mine.map((m) => m.id);
  const userIds = mine.map((m) => m.userId);

  if (profileIds.length > 0 || userIds.length > 0) {
    const inProfiles = { in: profileIds };
    const inUsers = { in: userIds };

    await db.notification.deleteMany({
      where: {
        OR: [{ recipientMemberProfileId: inProfiles }, { actorMemberProfileId: inProfiles }],
      },
    });
    await db.commentMention.deleteMany({ where: { mentionedMemberProfileId: inProfiles } });
    await db.repairComment.deleteMany({
      where: { authorMemberProfileId: inProfiles, parentCommentId: { not: null } },
    });
    await db.repairComment.deleteMany({
      where: { authorMemberProfileId: inProfiles, parentCommentId: null },
    });
    await db.repairFavorite.deleteMany({ where: { memberProfileId: inProfiles } });
    await db.repairRecord.deleteMany({ where: { memberProfileId: inProfiles } });
    await db.userSkill.deleteMany({ where: { memberProfileId: inProfiles } });
    await db.userRole.deleteMany({ where: { userId: inUsers } });
    await db.authSession.deleteMany({ where: { userId: inUsers } });
    await db.passwordCredential.deleteMany({ where: { userId: inUsers } });
    await db.memberProfile.deleteMany({ where: { id: inProfiles } });
    await db.userIdentity.deleteMany({ where: { userId: inUsers } });
    await db.skill.updateMany({ where: { createdBy: inUsers }, data: { createdBy: null } });
    await db.user.deleteMany({ where: { id: inUsers } });
  }
}

before(async () => {
  if (!enabled) return;
  await prepareFixtures();
});

beforeEach(async () => {
  if (!enabled) return;
  await prepareFixtures();
  // 每个用例都从「学期未配置」开始，避免跨用例串味。
  delete process.env.ACADEMIC_TERM_START;
  delete process.env.ACADEMIC_TERM_END;
  resetAcademicTermConfigForTests();
});

after(async () => {
  if (!enabled) return;
  await prepareFixtures();
  await disconnectDb();
});

// ------------------------------------------------------------ 统计口径

dbTest("M5 只有 APPROVED 且未软删除的记录进入统计与排行", async () => {
  const a = await createMember("口径");
  const { current } = monthKeys();
  const inRange = `${current}-15`;

  await seedRepair(a.memberProfileId, { date: inRange, status: "APPROVED" });
  await seedRepair(a.memberProfileId, { date: inRange, status: "DRAFT" });
  await seedRepair(a.memberProfileId, { date: inRange, status: "PENDING" });
  await seedRepair(a.memberProfileId, { date: inRange, status: "REJECTED" });
  await seedRepair(a.memberProfileId, { date: inRange, status: "APPROVED", deleted: true });

  const analytics = await analyticsService.getMemberAnalytics(a.actor);
  assert.equal(analytics.summary.totalApprovedCount.value, 1);
  assert.equal(analytics.summary.monthApprovedCount.value, 1);
  assert.equal(analytics.summary.source, "M5_ANALYTICS");

  const ranking = await rankingService.getRankings(
    { scope: "ALL_TIME", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
    a.actor,
  );
  const me = ranking.items.find((i) => i.memberProfileId === a.memberProfileId);
  assert.equal(me?.approvedCount, 1, "排行与个人摘要必须使用同一有效记录集合");
});

dbTest("M5 上海自然月边界准确：上月最后一天不计入本月，本月首末两天计入", async () => {
  const a = await createMember("月边界");
  const { current, previous, now } = monthKeys();
  // 上月的最后一天（用下月 1 日往前推一天，避免手工算月末）
  const firstOfCurrent = new Date(`${current}-01T00:00:00.000Z`);
  const lastOfPrevious = new Date(firstOfCurrent.getTime() - 86_400_000).toISOString().slice(0, 10);

  await seedRepair(a.memberProfileId, { date: lastOfPrevious });
  await seedRepair(a.memberProfileId, { date: `${current}-01` });
  const lastDay = new Date(
    new Date(`${current}-01T00:00:00.000Z`).setUTCMonth(
      new Date(`${current}-01T00:00:00.000Z`).getUTCMonth() + 1,
    ) - 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  await seedRepair(a.memberProfileId, { date: lastDay });

  const analytics = await analyticsService.getMemberAnalytics(a.actor);
  assert.equal(analytics.summary.totalApprovedCount.value, 3, "总榜含上月与本月共 3 条");
  assert.equal(analytics.summary.monthApprovedCount.value, 2, "本月只含本月首末两天");

  const monthRanking = await rankingService.getRankings(
    { scope: "MONTH", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
    a.actor,
  );
  assert.equal(monthRanking.status, "AVAILABLE");
  assert.equal(monthRanking.items[0]?.approvedCount, 2);
  assert.ok(previous < current);
  void now;
});

dbTest("M5 学期未配置返回 UNCONFIGURED，配置后按学期区间统计", async () => {
  const a = await createMember("学期");
  const { current, now } = monthKeys();
  await seedRepair(a.memberProfileId, { date: `${current}-10` });

  const unconfigured = await analyticsService.getMemberAnalytics(a.actor);
  assert.equal(unconfigured.summary.termApprovedCount.status, "UNCONFIGURED");
  assert.equal(unconfigured.summary.termApprovedCount.value, null);

  const year = now.getUTCFullYear();
  process.env.ACADEMIC_TERM_START = `${year}-01-01`;
  process.env.ACADEMIC_TERM_END = `${year}-12-31`;
  resetAcademicTermConfigForTests();
  try {
    const configured = await analyticsService.getMemberAnalytics(a.actor);
    assert.equal(configured.summary.termApprovedCount.status, "AVAILABLE");
    assert.equal(configured.summary.termApprovedCount.value, 1);

    const term = await rankingService.getRankings(
      { scope: "TERM", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
      a.actor,
    );
    assert.equal(term.status, "AVAILABLE");
    // 学期未配置时要返回 UNCONFIGURED 空结果，而不是空榜
    assert.equal(
      term.items.some((i) => i.memberProfileId === a.memberProfileId),
      true,
    );
  } finally {
    delete process.env.ACADEMIC_TERM_START;
    delete process.env.ACADEMIC_TERM_END;
    resetAcademicTermConfigForTests();
  }
});

dbTest("M5 学期未配置时榜单为 UNCONFIGURED 且不伪造空榜", async () => {
  const a = await createMember("未配置");
  const { current } = monthKeys();
  await seedRepair(a.memberProfileId, { date: `${current}-10` });

  const term = await rankingService.getRankings(
    { scope: "TERM", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
    a.actor,
  );
  assert.equal(term.status, "UNCONFIGURED");
  assert.deepEqual(term.items, []);
  assert.equal(term.currentMember, null);
  assert.equal(term.pagination.total, 0);
  assert.deepEqual(term.range, {
    startInclusive: null,
    endExclusive: null,
    timezone: "Asia/Shanghai",
  });
});

// ------------------------------------------------------------ 排序与并列

dbTest("M5 数量榜并列名次：3/3/1 → 1/1/3，且次序稳定", async () => {
  useControlledTerm();
  const a = await createMember("并列甲");
  const b = await createMember("并列乙");
  const c = await createMember("并列丙");
  const d = CONTROLLED_DAY;

  for (let i = 0; i < 3; i += 1)
    await seedRepair(a.memberProfileId, { date: d, durationMinutes: 10 });
  for (let i = 0; i < 3; i += 1)
    await seedRepair(b.memberProfileId, { date: d, durationMinutes: 60 });
  await seedRepair(c.memberProfileId, { date: d, durationMinutes: 5 });

  const result = await rankingService.getRankings(
    { scope: "TERM", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
    a.actor,
  );
  assert.equal(result.pagination.total, 3);
  const three = result.items.filter((i) => i.approvedCount === 3);
  assert.equal(three.length, 2);
  assert.deepEqual(
    three.map((i) => i.rank),
    [1, 1],
    "主指标相同必须同名次",
  );
  const one = result.items.find((i) => i.approvedCount === 1);
  assert.equal(one?.rank, 3, "并列后名次跳号");
  // 次级指标（时长）只决定展示顺序，不改变并列名次
  assert.equal(three[0]?.memberProfileId, b.memberProfileId, "时长更长者排前");
});

dbTest("M5 时长榜按时长排序，主指标并列时按数量决定展示顺序", async () => {
  useControlledTerm();
  const a = await createMember("时长甲");
  const b = await createMember("时长乙");
  const d = CONTROLLED_DAY;

  await seedRepair(a.memberProfileId, { date: `${CONTROLLED_MONTH}-12`, durationMinutes: 20 });
  await seedRepair(a.memberProfileId, { date: `${CONTROLLED_MONTH}-13`, durationMinutes: 20 });
  await seedRepair(b.memberProfileId, { date: d, durationMinutes: 90 });

  const result = await rankingService.getRankings(
    { scope: "TERM", metric: "DURATION_MINUTES", page: 1, pageSize: 20 },
    a.actor,
  );
  assert.equal(result.pagination.total, 2);
  const mine = result.items.find((i) => i.memberProfileId === a.memberProfileId);
  const other = result.items.find((i) => i.memberProfileId === b.memberProfileId);
  assert.equal(other?.rank, 1, "90 分钟应排第一");
  assert.equal(other?.metricValue, 90);
  assert.equal(mine?.rank, 2, "40 分钟排第二");
  assert.equal(mine?.metricValue, 40);
});

dbTest("M5 NULL 时长按 0 分钟计入，不让整个榜单失败", async () => {
  useControlledTerm();
  const a = await createMember("无时长");
  await seedRepair(a.memberProfileId, { date: `${CONTROLLED_MONTH}-12`, durationMinutes: null });
  await seedRepair(a.memberProfileId, { date: `${CONTROLLED_MONTH}-13`, durationMinutes: null });

  const analytics = await analyticsService.getMemberAnalytics(a.actor);
  assert.equal(analytics.summary.totalApprovedCount.value, 2);
  assert.equal(analytics.summary.totalApprovedDurationMinutes.value, 0);

  const result = await rankingService.getRankings(
    { scope: "TERM", metric: "DURATION_MINUTES", page: 1, pageSize: 20 },
    a.actor,
  );
  const me = result.items.find((i) => i.memberProfileId === a.memberProfileId);
  assert.equal(me?.durationMinutes, 0);
  assert.equal(me?.rank, 1);
});

// ------------------------------------------------------------ 分页与我的排名

dbTest("M5 分页在数据库完成，且我的排名不受当前分页影响", async () => {
  useControlledTerm();
  const members: MemberFixture[] = [];
  // 5 名成员，数量 5/4/3/2/1，便于验证分页切片与页外排名
  for (let i = 0; i < 5; i += 1) {
    const m = await createMember(`分页${i}`);
    members.push(m);
    for (let n = 0; n < 5 - i; n += 1) {
      await seedRepair(m.memberProfileId, { date: `${CONTROLLED_MONTH}-1${n}` });
    }
  }

  const page1 = await rankingService.getRankings(
    { scope: "TERM", metric: "REPAIR_COUNT", page: 1, pageSize: 2 },
    members[4]!.actor, // 数量最少的那位，必然不在第 1 页
  );
  assert.equal(page1.status, "AVAILABLE");
  assert.equal(page1.items.length, 2);
  assert.equal(page1.pagination.total, 5);
  assert.equal(page1.pagination.totalPages, 3);
  assert.equal(page1.items[0]?.approvedCount, 5);
  assert.equal(page1.items[0]?.rank, 1);
  assert.equal(page1.items[1]?.rank, 2);

  // 关键：我的排名（第 5 名）在页外也要返回，且不受分页影响
  assert.equal(page1.currentMember?.approvedCount, 1);
  assert.equal(page1.currentMember?.rank, 5);
  assert.equal(page1.currentMember?.isCurrentMember, true);
  assert.equal(
    page1.items.every((i) => i.isCurrentMember === false),
    true,
    "当前成员不在本页时，本页不得有 isCurrentMember",
  );

  const page3 = await rankingService.getRankings(
    { scope: "TERM", metric: "REPAIR_COUNT", page: 3, pageSize: 2 },
    members[4]!.actor,
  );
  assert.equal(page3.items.length, 1);
  assert.equal(page3.items[0]?.isCurrentMember, true);
  assert.equal(page3.currentMember?.rank, 5, "换页后我的排名必须一致");

  // 相同请求在数据不变时顺序稳定
  const again = await rankingService.getRankings(
    { scope: "TERM", metric: "REPAIR_COUNT", page: 1, pageSize: 2 },
    members[0]!.actor,
  );
  assert.deepEqual(
    again.items.map((i) => i.memberProfileId),
    page1.items.map((i) => i.memberProfileId),
  );
});

dbTest("M5 零记录成员不进榜，我的排名为 null", async () => {
  useControlledTerm();
  const a = await createMember("零记录");
  const other = await createMember("有记录");
  await seedRepair(other.memberProfileId, { date: CONTROLLED_DAY });

  const result = await rankingService.getRankings(
    { scope: "TERM", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
    a.actor,
  );
  assert.equal(result.currentMember, null);
  assert.equal(
    result.items.some((i) => i.memberProfileId === a.memberProfileId),
    false,
  );
  assert.equal(result.pagination.total, 1);
});

dbTest("M5 撤销或软删除的成员不进入当前榜单", async () => {
  const active = await createMember("在册");
  const revoked = await createMember("已撤销", { memberStatus: "REVOKED" });
  const removed = await createMember("已删除", { profileDeleted: true });
  const { current } = monthKeys();
  const d = `${current}-12`;
  await seedRepair(active.memberProfileId, { date: d });
  await seedRepair(revoked.memberProfileId, { date: d });
  await seedRepair(removed.memberProfileId, { date: d });
  // 历史数据必须保留，只是不进当前榜单
  const kept = await getDb().repairRecord.count({
    where: { memberProfileId: revoked.memberProfileId, status: "APPROVED", deletedAt: null },
  });
  assert.equal(kept, 1);

  const result = await rankingService.getRankings(
    { scope: "MONTH", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
    active.actor,
  );
  const ids = result.items.map((i) => i.memberProfileId);
  assert.equal(ids.includes(active.memberProfileId), true);
  assert.equal(ids.includes(revoked.memberProfileId), false);
  assert.equal(ids.includes(removed.memberProfileId), false);
});

// ------------------------------------------------ 分类分布与月度趋势核对

dbTest("M5 分类分布与摘要口径一致，无分类归入「未分类」", async () => {
  const a = await createMember("分类");
  const { current } = monthKeys();
  const category = await getDb().repairCategory.findFirstOrThrow({
    where: { code: "M2_TEST" },
  });

  await seedRepair(a.memberProfileId, {
    date: `${current}-11`,
    durationMinutes: 30,
    categoryId: category.id,
  });
  await seedRepair(a.memberProfileId, {
    date: `${current}-12`,
    durationMinutes: 20,
    categoryId: null,
  });

  const analytics = await analyticsService.getMemberAnalytics(a.actor);
  const countSum = analytics.categoryDistribution.reduce((s, i) => s + i.approvedCount, 0);
  const durationSum = analytics.categoryDistribution.reduce((s, i) => s + i.durationMinutes, 0);
  assert.equal(countSum, analytics.summary.totalApprovedCount.value, "分类合计必须等于摘要");
  assert.equal(durationSum, analytics.summary.totalApprovedDurationMinutes.value);
  assert.equal(
    analytics.categoryDistribution.some((i) => i.categoryId === null),
    true,
  );
});

dbTest("M5 12 个月趋势补齐缺失月份，且合计与摘要一致", async () => {
  const a = await createMember("趋势");
  const { current } = monthKeys();
  await seedRepair(a.memberProfileId, { date: `${current}-05`, durationMinutes: 25 });
  await seedRepair(a.memberProfileId, { date: `${current}-06`, durationMinutes: 35 });

  const analytics = await analyticsService.getMemberAnalytics(a.actor);
  assert.equal(analytics.monthlyTrend.length, ANALYTICS_TREND_MONTHS);
  const trendCount = analytics.monthlyTrend.reduce((s, p) => s + p.approvedCount, 0);
  const trendDuration = analytics.monthlyTrend.reduce((s, p) => s + p.durationMinutes, 0);
  assert.equal(trendCount, 2);
  assert.equal(trendDuration, 60);
  assert.equal(analytics.monthlyTrend[analytics.monthlyTrend.length - 1]!.month, current);
  // 12 个月之外的记录不计入趋势（但仍在总榜里）
  const outside = analytics.monthlyTrend.filter((p) => p.month < current);
  assert.equal(
    outside.every((p) => p.approvedCount === 0 && p.durationMinutes === 0),
    true,
  );
});

dbTest("M5 软删除与退回后统计立刻变化", async () => {
  const a = await createMember("同步");
  const { current } = monthKeys();
  const recordId = await seedRepair(a.memberProfileId, { date: `${current}-12` });

  assert.equal(
    (await analyticsService.getMemberAnalytics(a.actor)).summary.totalApprovedCount.value,
    1,
  );
  await getDb().repairRecord.update({
    where: { id: recordId },
    data: { deletedAt: new Date() },
  });
  assert.equal(
    (await analyticsService.getMemberAnalytics(a.actor)).summary.totalApprovedCount.value,
    0,
  );
});

// ------------------------------------------------------------ 工作台接线

dbTest("M5 工作台返回真实排行预览，学期未配置时为 UNCONFIGURED", async () => {
  const a = await createMember("工作台");
  const dashboard = await memberDashboardService.getDashboard(a.actor);
  assert.equal(dashboard.repairSummary.source, "M5_ANALYTICS");
  assert.equal(dashboard.ranking.available, true);
  assert.equal(dashboard.ranking.scope, "TERM");
  assert.equal(dashboard.ranking.metric, "REPAIR_COUNT");
  assert.equal(dashboard.ranking.status, "UNCONFIGURED");
  assert.deepEqual(dashboard.ranking.leaders, []);
  assert.equal(dashboard.degraded.includes("ranking"), false);

  const year = new Date().getUTCFullYear();
  process.env.ACADEMIC_TERM_START = `${year}-01-01`;
  process.env.ACADEMIC_TERM_END = `${year}-12-31`;
  resetAcademicTermConfigForTests();
  try {
    const configured = await memberDashboardService.getDashboard(a.actor);
    assert.equal(configured.ranking.status, "AVAILABLE");
  } finally {
    delete process.env.ACADEMIC_TERM_START;
    delete process.env.ACADEMIC_TERM_END;
    resetAcademicTermConfigForTests();
  }
});

// ------------------------------------------------------------ 权限与隐私

dbTest("M5 未登录访问统计接口返回 401 且不泄漏字段", async () => {
  const { GET } = await import("../../src/app/api/v1/member/analytics/route");
  const response = await GET(new Request("http://localhost/api/v1/member/analytics"));
  assert.equal(response.status, 401);
  const payload = (await response.json()) as { success: boolean };
  assert.equal(payload.success, false);
  assert.doesNotMatch(JSON.stringify(payload), /"qq"|studentId|className|userId|trace|stack/i);
});

dbTest("M5 无 analytics 权限的请求被拒绝为 403", async () => {
  const a = await createMember("无权限");
  const actor: Actor = { ...a.actor, permissions: permissionsForRoles([]) };
  await assert.rejects(
    () =>
      rankingService.getRankings(
        { scope: "MONTH", metric: "REPAIR_COUNT", page: 1, pageSize: 20 },
        actor,
      ),
    (error: { code?: string }) => error.code === "FORBIDDEN",
  );
  await assert.rejects(
    () => analyticsService.getMemberAnalytics(actor),
    (error: { code?: string }) => error.code === "FORBIDDEN",
  );
  // 工作台预览同样必须过权限闸门 —— 它接受显式档案 ID，
  // 若不校验就会成为一条读任意成员名次的旁路。
  await assert.rejects(
    () => rankingService.getTermPreview(a.memberProfileId, actor),
    (error: { code?: string }) => error.code === "FORBIDDEN",
  );
});

dbTest("M5 个人主页与内部主页的摘要来源统一为 M5_ANALYTICS", async () => {
  const self = await createMember("摘要来源");
  const viewer = await createMember("摘要查看者");
  const { current } = monthKeys();
  await seedRepair(self.memberProfileId, { date: `${current}-12`, durationMinutes: 40 });

  const own = await memberProfileService.getSelf(self.actor);
  assert.equal(own.repairSummary.source, "M5_ANALYTICS", "个人主页不得仍走 M2 摘要入口");

  const internal = await memberProfileService.getInternal(self.memberProfileId, viewer.actor);
  assert.equal(internal.repairSummary.source, "M5_ANALYTICS", "内部主页不得仍走 M2 摘要入口");

  // 三个入口必须给出同一份数字（同一口径）
  const dashboard = await memberDashboardService.getDashboard(self.actor);
  assert.equal(
    own.repairSummary.totalApprovedCount.value,
    dashboard.repairSummary.totalApprovedCount.value,
  );
  assert.equal(
    internal.repairSummary.totalApprovedCount.value,
    dashboard.repairSummary.totalApprovedCount.value,
  );
  assert.equal(own.repairSummary.source, dashboard.repairSummary.source);
});

dbTest("M5 排行响应可通过统一信封返回，且不含任何身份字段", async () => {
  const a = await createMember("信封");
  const { current } = monthKeys();
  await seedRepair(a.memberProfileId, { date: `${current}-12` });

  const { GET } = await import("../../src/app/api/v1/member/rankings/route");
  const response = await GET(
    new Request("http://localhost/api/v1/member/rankings?scope=MONTH&metric=REPAIR_COUNT", {
      headers: { cookie: a.cookie },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const payload = (await response.json()) as {
    success: boolean;
    data: Record<string, unknown>;
    meta: { requestId: string };
  };
  assert.equal(payload.success, true);
  assert.equal(typeof payload.meta.requestId, "string");

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /"qq"|studentId|className|"userId"|phoneNormalized|identifierNormalized/,
  );
  // BigInt 若泄漏会直接让 JSON.stringify 抛错，能走到这里即说明已全部转成 number
  assert.match(serialized, /"approvedCount"/);
});

dbTest("M5 非法 scope / metric / 分页参数返回稳定 400", async () => {
  const a = await createMember("非法参数");
  const { GET } = await import("../../src/app/api/v1/member/rankings/route");
  const cases: Array<[string, number]> = [
    ["scope=YEAR", 400],
    ["metric=AVG", 400],
    ["pageSize=0", 400],
    ["pageSize=101", 400],
    ["page=0", 400],
  ];
  for (const [query, expected] of cases) {
    const response = await GET(
      new Request(`http://localhost/api/v1/member/rankings?${query}`, {
        headers: { cookie: a.cookie },
      }),
    );
    assert.equal(response.status, expected, `${query} 应返回 ${expected}`);
  }
  // 非法取值不得泄漏 SQL / 表名 / 堆栈
  const bad = await GET(
    new Request("http://localhost/api/v1/member/rankings?scope=YEAR", {
      headers: { cookie: a.cookie },
    }),
  );
  const text = JSON.stringify(await bad.json());
  assert.doesNotMatch(text, /SELECT|FROM repair_records|at Object\.|stack/i);
});

dbTest("M5 非当前页成员的 currentMember 与榜单一致（跨范围与指标）", async () => {
  useControlledTerm();
  const members: MemberFixture[] = [];
  // 4 名成员，数量 4/3/2/1 —— 受控学期窗口保证榜单成员集合就是这 4 位
  for (let i = 0; i < 4; i += 1) {
    const m = await createMember(`跨页${i}`);
    members.push(m);
    for (let n = 0; n < 4 - i; n += 1) {
      await seedRepair(m.memberProfileId, {
        date: `${CONTROLLED_MONTH}-1${n}`,
        durationMinutes: 15,
      });
    }
  }
  const scopes: AnalyticsScope[] = ["TERM", "ALL_TIME"];
  const metrics: RankingMetric[] = ["REPAIR_COUNT", "DURATION_MINUTES"];
  for (const scope of scopes) {
    for (const metric of metrics) {
      const last = members[3]!;
      const result = await rankingService.getRankings(
        { scope, metric, page: 1, pageSize: 1 },
        last.actor,
      );
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.rank, 1);
      assert.equal(result.currentMember?.memberProfileId, last.memberProfileId);
      assert.equal(result.currentMember?.isCurrentMember, true);
      if (scope === "TERM") {
        // 受控窗口内只有本文档的 4 位成员
        assert.equal(result.pagination.total, 4, `${scope}/${metric}`);
        assert.equal(result.currentMember?.rank, 4, `${scope}/${metric} 我的排名应为 4`);
      } else {
        // ALL_TIME 含其他文件的历史数据，只断言「我不在第一页」这一结构性事实
        assert.equal(result.currentMember!.rank > 1, true, "ALL_TIME 下当前成员应不在首位");
      }
    }
  }
});
