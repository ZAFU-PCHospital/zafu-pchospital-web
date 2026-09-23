import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { memberDashboardService } from "../../src/features/member-dashboard/member-dashboard-service";
import { memberProfileService } from "../../src/features/member-profile/member-profile-service";
import { memberService } from "../../src/features/members/member-service";
import { repairService } from "../../src/features/repairs/repair-service";
import { repairPhotoService } from "../../src/features/repairs/repair-photo-service";
import { repairReviewService } from "../../src/features/repairs/repair-review-service";
import { skillRepository } from "../../src/features/skills/skill-repository";
import { skillService } from "../../src/features/skills/skill-service";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { digestSessionToken } from "../../src/lib/security/secrets";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { resetAcademicTermConfigForTests } from "../../src/lib/academic-term";
import type { AuthorizedActor } from "../../src/types/contracts";
import { MEMBER_SKILL_LIMIT } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
/**
 * 本文件使用**独立的** admin UUID，不复用 M2 测试的 `10000000-…-0001`。
 * 原因：`tsx --test tests/integration/**` 把两个文件放在同一进程顺序执行，
 * 共享同一个数据库；M2 文件的 `after` 会 `disconnectDb()` 并在下次 `before`
 * 里清空 users 表，复用同一 id 会让本文件的 FK（rolesGranted.granted_by）悬空。
 * 独立 id + 独立档案可彻底解耦两个文件的 fixture 生命周期。
 */
const adminId = "b3000000-0000-4000-8000-000000000001";
const adminProfileId = "b3000000-0000-4000-8000-000000000002";

let uploadTestRoot = "";

/**
 * 修复 M3 自身 fixture，并清掉上一轮遗留的 M3 数据。
 *
 * ⚠️ 本文件与 M2 集成测试（`m0-database.test.ts`）**共享同一个数据库、同一个进程**，
 * 而 M2 的 `before()` 会全表 `deleteMany()`（含 users / member_profiles）。
 * `tsx --test` 对两个文件的执行顺序不做保证，因此这里**不能只依赖 `before()` 的一次性准备**：
 * 必须在**每个测试前**重新对齐 fixture，否则先跑 M2 时会把它清掉、
 * 先跑 M3 时又会因残留 user_skills 让 M2 的 memberProfile.deleteMany() 报外键错。
 *
 * 清理动作全部按 `realName` 前缀 "M3 " 限定，只动本文件自己的数据；
 * seed 技能与共享角色一律复用、不重建。
 */
async function prepareFixtures(): Promise<void> {
  const db = getDb();

  // 1) 清掉上一轮遗留（顺序：子表 → 父表，避免外键冲突）。
  //    这些 deleteMany 本身是幂等的，即使上一轮被中断也不会有残留阻塞。
  await db.notification.deleteMany({
    where: { recipient: { realName: { startsWith: "M3 " } } },
  });
  await db.commentMention.deleteMany({
    where: { comment: { record: { memberProfile: { realName: { startsWith: "M3 " } } } } },
  });
  // `parent_comment_id` 是自引用外键：必须先删回复，再删根评论，
  // 否则一条 DELETE 会被尚未删除的回复挡住（见 m0 清理处的同款说明）。
  const m3Comments = { record: { memberProfile: { realName: { startsWith: "M3 " } } } };
  await db.repairComment.deleteMany({
    where: { ...m3Comments, parentCommentId: { not: null } },
  });
  await db.repairComment.deleteMany({
    where: { ...m3Comments, parentCommentId: null },
  });
  await db.repairFavorite.deleteMany({
    where: { memberProfile: { realName: { startsWith: "M3 " } } },
  });
  await db.repairTimelineEvent.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M3 " } } } },
  });
  await db.repairReview.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M3 " } } } },
  });
  await db.repairPhoto.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M3 " } } } },
  });
  await db.repairRecord.deleteMany({
    where: { memberProfile: { realName: { startsWith: "M3 " } } },
  });
  await db.userSkill.deleteMany({ where: { memberProfile: { realName: { startsWith: "M3 " } } } });
  await db.auditLog.deleteMany({ where: { targetType: "MemberProfile" } });

  // 2) 重建本文件依赖的 fixture（先查后建，upsert 在本机会误走 create 分支）。
  await ensureUser(adminId, "M3 Admin");
  await ensureMemberProfile(adminProfileId, adminId, "M3 Admin");
  await ensureRepairCategory("91000000-0000-4000-8000-000000000003", "M3_TEST", "M3 测试分类");
}

before(async () => {
  if (!enabled) return;
  // 维修照片存储落到独立临时目录，避免污染仓库内的 ./storage/uploads。
  uploadTestRoot = await mkdtemp(join(tmpdir(), "pc-hospital-m3-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
  await prepareFixtures();
});

// M2 文件的 before() 可能在本文件之后执行并清空全表，
// 因此每个测试前重新对齐一次，保证 fixture 一定在位。
beforeEach(async () => {
  if (!enabled) return;
  await prepareFixtures();
});

async function ensureUser(id: string, displayName: string): Promise<void> {
  const db = getDb();
  if (await db.user.findUnique({ where: { id } })) return;
  await db.user.create({
    data: { id, status: "ACTIVE", displayName, createdAt: new Date(), updatedAt: new Date() },
  });
}

async function ensureMemberProfile(id: string, userId: string, realName: string): Promise<void> {
  const db = getDb();
  if (await db.memberProfile.findUnique({ where: { id } })) return;
  await db.memberProfile.create({
    data: { id, userId, realName, status: "ACTIVE", joinedAt: new Date(), createdAt: new Date() },
  });
}

async function ensureRepairCategory(id: string, code: string, name: string): Promise<void> {
  const db = getDb();
  if (await db.repairCategory.findFirst({ where: { code } })) return;
  await db.repairCategory.create({
    data: { id, code, name, sortOrder: 1, createdAt: new Date() },
  });
}

after(async () => {
  if (enabled) {
    await disconnectDb();
    if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
  }
});

const adminActor: AuthorizedActor = {
  actorType: "USER",
  userId: adminId,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m3_admin",
};

function memberActor(userId: string, requestId: string): AuthorizedActor {
  return {
    actorType: "USER",
    userId,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["MEMBER"]),
    requestId,
  };
}

/** 直建一个有效成员，返回 userId 与 memberProfileId。 */
let memberSeq = 0;
async function createMember(label: string) {
  // QQ 需 5–11 位数字；手机号需 1[3-9] + **8** 位（共 11 位）。
  // 用自增序号保证同一进程内唯一，避免 Date.now() 同毫秒复用导致唯一约束冲突。
  memberSeq += 1;
  const tail = `${Date.now()}`.slice(-5);
  const serial = `${tail}${String(memberSeq).padStart(3, "0")}`.slice(-8);
  return memberService.create(
    {
      realName: `M3 ${label}`,
      qq: `8${serial}`,
      phone: `139${serial}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
}

/** 走完整 M2 闭环，产出一条已通过维修记录。 */
async function createApprovedRepair(
  owner: AuthorizedActor,
  options: { repairDate: string; durationMinutes: number },
) {
  const key = randomUUID();
  const draft = await repairService.createDraft({ idempotencyKey: key }, owner);
  const category = await getDb().repairCategory.findUniqueOrThrow({ where: { code: "M3_TEST" } });
  const updated = await repairService.update(
    draft.id,
    {
      version: draft.version,
      repairDate: options.repairDate,
      durationMinutes: options.durationMinutes,
      categoryId: category.id,
      // 提交校验要求正文 ≥ 10 字（按 trim 后长度计）。
      content: "M3 集成测试维修记录正文内容，用于覆盖统计与摘要。",
      result: "COMPLETED",
    },
    owner,
  );
  // 提交校验要求 photoCount ≥ 1：必须先上传至少一张照片。
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await repairPhotoService.upload(
    draft.id,
    [new File([png], "m3-case.png", { type: "image/png" })],
    owner,
  );
  const submitted = await repairService.submit(
    draft.id,
    { version: updated.version, idempotencyKey: randomUUID() },
    owner,
  );
  assert.equal(submitted.status, "PENDING");
  return repairReviewService.review(
    draft.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    adminActor,
  );
}

// ---------------------------------------------------------------------------
// Seed 与技能读取
// ---------------------------------------------------------------------------

dbTest("M3 技能 Seed 提供八个稳定 code 且可重复执行", async () => {
  const skills = await skillService.listActive();
  const codes = skills.map((skill) => skill.code);
  for (const code of [
    "WINDOWS",
    "HARDWARE",
    "NETWORK",
    "LINUX",
    "LAPTOP_DISASSEMBLY",
    "SYSTEM_INSTALLATION",
    "DRIVER",
    "STORAGE",
  ]) {
    assert.equal(codes.includes(code), true, `缺少技能 code：${code}`);
  }
  // 再次读取应保持稳定（Seed 幂等，不产生重复 code）
  const again = await skillService.listActive();
  assert.equal(new Set(again.map((s) => s.code)).size, again.length);
});

// ---------------------------------------------------------------------------
// 昵称更新（乐观锁）
// ---------------------------------------------------------------------------

dbTest("M3 昵称更新遵循乐观锁且审计落库", async () => {
  const created = await createMember("昵称");
  const actor = memberActor(created.member.userId, "req_m3_nickname");
  const before = await memberProfileService.getSelf(actor);
  assert.equal(before.profile.version, 1);

  const updated = await memberProfileService.updateProfile(
    { nickname: "  小林  ", version: before.profile.version },
    actor,
  );
  // 首尾空白被规范化后落库
  assert.equal(updated.profile.nickname, "小林");
  assert.equal(updated.version, before.profile.version + 1);

  // 旧版本再次提交 → 409
  await assert.rejects(
    () =>
      memberProfileService.updateProfile(
        { nickname: "过期", version: before.profile.version },
        actor,
      ),
    (error) => error instanceof AppError && error.code === "MEMBER_PROFILE_VERSION_CONFLICT",
  );

  // 显式 null 清空
  const cleared = await memberProfileService.updateProfile(
    { nickname: null, version: updated.version },
    actor,
  );
  assert.equal(cleared.profile.nickname, null);

  const audits = await getDb().auditLog.findMany({
    where: { action: "MEMBER_PROFILE_UPDATED", targetId: created.member.id },
  });
  assert.equal(audits.length, 2);
});

dbTest("M3 昵称非法输入被拒绝且不落库", async () => {
  const created = await createMember("非法昵称");
  const actor = memberActor(created.member.userId, "req_m3_bad_nickname");
  const current = await memberProfileService.getSelf(actor);
  for (const bad of ["x".repeat(65), "包含\u0000控制字符"]) {
    await assert.rejects(
      () =>
        memberProfileService.updateProfile(
          { nickname: bad, version: current.profile.version },
          actor,
        ),
      (error) => error instanceof AppError && error.code === "MEMBER_PROFILE_INVALID_NICKNAME",
    );
  }
  const after = await memberProfileService.getSelf(actor);
  assert.equal(after.profile.version, current.profile.version);
});

// ---------------------------------------------------------------------------
// 技能集合：唯一约束、软删除与恢复
// ---------------------------------------------------------------------------

dbTest("M3 技能保存幂等且取消走软删除、再次选择恢复同一行", async () => {
  const created = await createMember("技能");
  const actor = memberActor(created.member.userId, "req_m3_skills");
  const skills = await skillService.listActive();
  const first = skills[0]!;
  const second = skills[1]!;
  const current = await memberProfileService.getSelf(actor);

  const saved = await memberProfileService.updateSkills(
    { skillIds: [first.id, second.id, first.id], profileVersion: current.profile.version },
    actor,
  );
  // 去重后 2 项
  assert.equal(saved.skills.length, 2);
  assert.equal(saved.version, current.profile.version + 1);

  const rowsAfterCreate = await getDb().userSkill.findMany({
    where: { memberProfileId: created.member.id },
  });
  assert.equal(rowsAfterCreate.length, 2);

  // 移除第二项 → 软删除而非物理删除
  const removed = await memberProfileService.updateSkills(
    { skillIds: [first.id], profileVersion: saved.version },
    actor,
  );
  assert.equal(removed.skills.length, 1);
  const rowsAfterRemove = await getDb().userSkill.findMany({
    where: { memberProfileId: created.member.id },
  });
  assert.equal(rowsAfterRemove.length, 2, "取消关联不得物理删除历史行");
  assert.equal(rowsAfterRemove.filter((row) => row.deletedAt !== null).length, 1);

  // 再次选择 → 复用同一行（id 不变），只清空 deletedAt
  const restored = await memberProfileService.updateSkills(
    { skillIds: [first.id, second.id], profileVersion: removed.version },
    actor,
  );
  assert.equal(restored.skills.length, 2);
  const rowsAfterRestore = await getDb().userSkill.findMany({
    where: { memberProfileId: created.member.id },
  });
  assert.equal(rowsAfterRestore.length, 2, "恢复不得新建关联行");
  assert.equal(rowsAfterRestore.filter((row) => row.deletedAt === null).length, 2);
  assert.deepEqual(
    rowsAfterRestore.map((row) => row.id).sort(),
    rowsAfterCreate.map((row) => row.id).sort(),
  );

  // 重复 PUT 同一集合且版本最新 → 不产生重复关联
  const repeated = await memberProfileService.updateSkills(
    { skillIds: [first.id, second.id], profileVersion: restored.version },
    actor,
  );
  assert.equal(repeated.skills.length, 2);
  assert.equal(await getDb().userSkill.count({ where: { memberProfileId: created.member.id } }), 2);
});

dbTest("M3 技能数量上限与未知技能被拒绝", async () => {
  const created = await createMember("技能边界");
  const actor = memberActor(created.member.userId, "req_m3_skill_limits");
  const current = await memberProfileService.getSelf(actor);

  const tooMany = Array.from({ length: MEMBER_SKILL_LIMIT + 1 }, (_, index) => `skill-${index}`);
  await assert.rejects(
    () =>
      memberProfileService.updateSkills(
        { skillIds: tooMany, profileVersion: current.profile.version },
        actor,
      ),
    (error) => error instanceof AppError && error.code === "SKILL_LIMIT_EXCEEDED",
  );

  await assert.rejects(
    () =>
      memberProfileService.updateSkills(
        { skillIds: [randomUUID()], profileVersion: current.profile.version },
        actor,
      ),
    (error) => error instanceof AppError && error.code === "SKILL_NOT_FOUND",
  );
});

dbTest("M3 已停用技能不能新增关联，但既有保留不被静默删除", async () => {
  const db = getDb();
  const created = await createMember("停用技能");
  const actor = memberActor(created.member.userId, "req_m3_skill_inactive");
  const skills = await skillService.listActive();
  const keep = skills[0]!;
  const toDisable = skills[1]!;
  const current = await memberProfileService.getSelf(actor);

  // 先正常关联两个
  const saved = await memberProfileService.updateSkills(
    { skillIds: [keep.id, toDisable.id], profileVersion: current.profile.version },
    actor,
  );

  // 直接停用其中一个技能（模拟 M6 管理操作），并顺带清掉 M3 的配置缓存无关
  await db.skill.update({ where: { id: toDisable.id }, data: { isActive: false } });
  try {
    // 1) 保存其他技能时，已停用的既有保留项不得被静默删除
    const renamed = await memberProfileService.updateSkills(
      { skillIds: [keep.id, toDisable.id], profileVersion: saved.version },
      actor,
    );
    assert.equal(renamed.skills.length, 2, "已停用但已关联的技能应被保留");

    // 2) 但把它当作**新增**选择时（先移除再重新加入）必须失败
    const dropped = await memberProfileService.updateSkills(
      { skillIds: [keep.id], profileVersion: renamed.version },
      actor,
    );
    await assert.rejects(
      () =>
        memberProfileService.updateSkills(
          { skillIds: [keep.id, toDisable.id], profileVersion: dropped.version },
          actor,
        ),
      (error) => error instanceof AppError && error.code === "SKILL_INACTIVE",
    );
  } finally {
    await db.skill.update({ where: { id: toDisable.id }, data: { isActive: true } });
    await db.skill.update({ where: { id: toDisable.id }, data: { isActive: true } });
  }
});

// ---------------------------------------------------------------------------
// 并发
// ---------------------------------------------------------------------------

dbTest("M3 并发旧版本保存只有一次成功", async () => {
  const created = await createMember("并发");
  const actor = memberActor(created.member.userId, "req_m3_concurrent");
  const current = await memberProfileService.getSelf(actor);
  const skills = await skillService.listActive();

  const results = await Promise.allSettled([
    memberProfileService.updateSkills(
      { skillIds: [skills[0]!.id], profileVersion: current.profile.version },
      actor,
    ),
    memberProfileService.updateSkills(
      { skillIds: [skills[1]!.id], profileVersion: current.profile.version },
      actor,
    ),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "并发同版本提交只允许一个成功");
  assert.equal(rejected.length, 1);
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.equal(reason instanceof AppError && reason.code, "MEMBER_PROFILE_VERSION_CONFLICT");
});

// ---------------------------------------------------------------------------
// 工作台与摘要
// ---------------------------------------------------------------------------

dbTest("M3 工作台只统计本人已通过记录且不计入草稿待审退回", async () => {
  resetAcademicTermConfigForTests();
  const ownerCreated = await createMember("工作台甲");
  const otherCreated = await createMember("工作台乙");
  const owner = memberActor(ownerCreated.member.userId, "req_m3_dash_owner");
  const other = memberActor(otherCreated.member.userId, "req_m3_dash_other");

  // 本人：2 条已通过（90 + 30 分钟），1 条草稿、1 条待审核
  const today = new Date().toISOString().slice(0, 10);
  await createApprovedRepair(owner, { repairDate: today, durationMinutes: 90 });
  await createApprovedRepair(owner, { repairDate: today, durationMinutes: 30 });
  await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);
  const pending = await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);
  const category = await getDb().repairCategory.findUniqueOrThrow({ where: { code: "M3_TEST" } });
  const pendingUpdated = await repairService.update(
    pending.id,
    {
      version: pending.version,
      repairDate: today,
      durationMinutes: 15,
      categoryId: category.id,
      // 提交校验要求正文 ≥ 10 字，且至少一张照片。
      content: "待审核维修记录正文内容，长度满足提交校验下限。",
      result: "COMPLETED",
    },
    owner,
  );
  const pendingPng = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await repairPhotoService.upload(
    pending.id,
    [new File([pendingPng], "m3-pending.png", { type: "image/png" })],
    owner,
  );
  await repairService.submit(
    pending.id,
    { version: pendingUpdated.version, idempotencyKey: randomUUID() },
    owner,
  );

  // 他人：1 条已通过，不得计入本人摘要
  await createApprovedRepair(other, { repairDate: today, durationMinutes: 500 });

  const dashboard = await memberDashboardService.getDashboard(owner);
  assert.equal(dashboard.repairSummary.totalApprovedCount.value, 2);
  assert.equal(dashboard.repairSummary.totalApprovedCount.status, "AVAILABLE");
  assert.equal(dashboard.repairSummary.totalApprovedDurationMinutes.value, 120);
  assert.equal(dashboard.repairSummary.monthApprovedCount.value, 2);
  // 学期未配置 → UNCONFIGURED 且 value 为 null（绝不为 0）
  assert.equal(dashboard.repairSummary.termApprovedCount.status, "UNCONFIGURED");
  assert.equal(dashboard.repairSummary.termApprovedCount.value, null);
  // M5 起正式统计统一由 Analytics 入口产出，来源标注随之改为 M5_ANALYTICS。
  assert.equal(dashboard.repairSummary.source, "M5_ANALYTICS");
  // 工作队列只数本人非删除记录
  assert.deepEqual(dashboard.workQueue, { draftCount: 1, pendingCount: 1, rejectedCount: 0 });
  // 最近已通过记录不含草稿/待审
  assert.equal(dashboard.recentRepairs.length, 2);
  const recentIds = new Set(dashboard.recentRepairs.map((row) => row.id));
  assert.equal(recentIds.has(pending.id), false, "待审记录不得出现在已通过列表");
  // M4 摘要已接入：审核通过会给本人发未读通知；收藏仍为空。排行仍为 M5 占位。
  assert.equal(dashboard.notifications.available, true);
  assert.equal(dashboard.notifications.unreadCount, 2);
  assert.equal(dashboard.notifications.latest.length, 2);
  assert.equal(dashboard.favorites.available, true);
  assert.equal(dashboard.favorites.count, 0);
  // M5 起排行占位被替换为真实的本学期维修数量榜预览；学期未配置时状态为 UNCONFIGURED。
  assert.equal(dashboard.ranking.available, true);
  assert.equal(dashboard.ranking.scope, "TERM");
  assert.equal(dashboard.ranking.metric, "REPAIR_COUNT");
  assert.equal(dashboard.ranking.status, "UNCONFIGURED");
  assert.deepEqual(dashboard.ranking.leaders, []);
  // 工作台摘要不含 QQ
  assert.doesNotMatch(JSON.stringify(dashboard.profile), /"qq"/);
});

dbTest("M3 学期配置后按 UTC 边界统计且月份边界正确", async () => {
  const created = await createMember("学期");
  const actor = memberActor(created.member.userId, "req_m3_term");
  const today = new Date().toISOString().slice(0, 10);

  // 学期覆盖今天
  const year = Number(today.slice(0, 4));
  process.env.ACADEMIC_TERM_START = `${year}-01-01`;
  process.env.ACADEMIC_TERM_END = `${year}-12-31`;
  resetAcademicTermConfigForTests();

  try {
    await createApprovedRepair(actor, { repairDate: today, durationMinutes: 45 });
    const dashboard = await memberDashboardService.getDashboard(actor);
    assert.equal(dashboard.repairSummary.termApprovedCount.status, "AVAILABLE");
    assert.equal(dashboard.repairSummary.termApprovedCount.value, 1);
    assert.equal(dashboard.repairSummary.monthApprovedCount.value, 1);
  } finally {
    delete process.env.ACADEMIC_TERM_START;
    delete process.env.ACADEMIC_TERM_END;
    resetAcademicTermConfigForTests();
  }
});

// ---------------------------------------------------------------------------
// 可见性与隐私
// ---------------------------------------------------------------------------

dbTest("M3 他人内部主页不返回未通过记录且裁剪受控字段", async () => {
  const target = await createMember("被查看");
  const viewer = await createMember("查看者");
  const targetActor = memberActor(target.member.userId, "req_m3_target");
  const viewerActor = memberActor(viewer.member.userId, "req_m3_viewer");
  const today = new Date().toISOString().slice(0, 10);

  await createApprovedRepair(targetActor, { repairDate: today, durationMinutes: 60 });
  // 目标成员的草稿与待审记录不得出现在他人视图中
  await repairService.createDraft({ idempotencyKey: randomUUID() }, targetActor);

  const internal = await memberProfileService.getInternal(target.member.id, viewerActor);
  assert.equal(internal.recentRepairs.length, 1);
  // 裁剪：不含 userId / 学号 / 班级
  const serialized = JSON.stringify(internal.profile);
  assert.doesNotMatch(serialized, /userId|studentId|className/);
  // 内部视角保留 QQ（成员间可见），但不得暴露账号级 identity 明细。
  assert.doesNotMatch(serialized, /identifierNormalized|identities/);
  // 也不得暴露工作队列、草稿/待审计数或审计明细
  const serializedAll = JSON.stringify(internal);
  assert.doesNotMatch(serializedAll, /workQueue|draftCount|pendingCount|rejectedCount/);
  assert.doesNotMatch(serializedAll, /audit|requestId/);
  // 最近记录只含已通过项：契约里 MemberRecentRepair **不带 status 字段**
  // （带 status 的是工作台的 recentActivity），因此绝不可能泄露未通过状态。
  assert.equal("status" in internal.recentRepairs[0]!, false);
  // 草稿记录确实存在，却未出现在他人可见的最近记录里 —— 证明过滤生效而非恰好为空。
  const draftCount = await getDb().repairRecord.count({
    where: { memberProfileId: target.member.id, status: "DRAFT", deletedAt: null },
  });
  assert.equal(draftCount, 1);
  assert.equal(internal.recentRepairs.length, 1);
});

dbTest("M3 他人主页对不存在、软删除与非有效成员统一返回 404", async () => {
  const viewer = await createMember("枚举者");
  const viewerActor = memberActor(viewer.member.userId, "req_m3_enum");

  // 不存在
  await assert.rejects(
    () => memberProfileService.getInternal(randomUUID(), viewerActor),
    (error) => error instanceof AppError && error.code === "MEMBER_PROFILE_NOT_FOUND",
  );

  // 软删除
  const removed = await createMember("将被软删");
  const db = getDb();
  await db.memberProfile.update({
    where: { id: removed.member.id },
    data: { deletedAt: new Date() },
  });
  await assert.rejects(
    () => memberProfileService.getInternal(removed.member.id, viewerActor),
    (error) => error instanceof AppError && error.code === "MEMBER_PROFILE_NOT_FOUND",
  );

  // 非有效状态
  const inactive = await createMember("将停用");
  await db.memberProfile.update({
    where: { id: inactive.member.id },
    data: { status: "DISABLED" },
  });
  await assert.rejects(
    () => memberProfileService.getInternal(inactive.member.id, viewerActor),
    (error) => error instanceof AppError && error.code === "MEMBER_PROFILE_NOT_FOUND",
  );
});

dbTest("M3 技能列表与工作台响应均不含 QQ", async () => {
  const skills = await skillService.listActive();
  assert.doesNotMatch(JSON.stringify(skills), /qq|externalId|identity/i);

  const created = await createMember("隐私");
  const actor = memberActor(created.member.userId, "req_m3_privacy");
  // self 视图保留 QQ（受保护详情），但 summary 视图不保留
  const self = await memberProfileService.getSelf(actor);
  assert.equal(typeof self.profile.qq, "string");
  const dashboard = await memberDashboardService.getDashboard(actor);
  assert.doesNotMatch(JSON.stringify(dashboard), /"qq"/);
});

// ---------------------------------------------------------------------------
// 软删除过滤
// ---------------------------------------------------------------------------

dbTest("M3 技能仓库默认排除软删除技能", async () => {
  const db = getDb();
  const created = await createMember("技能软删");
  const actor = memberActor(created.member.userId, "req_m3_skill_softdelete");
  const skills = await skillService.listActive();
  const target = skills[0]!;
  const current = await memberProfileService.getSelf(actor);
  await memberProfileService.updateSkills(
    { skillIds: [target.id], profileVersion: current.profile.version },
    actor,
  );

  await db.skill.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
  try {
    const memberSkills = await skillRepository.listMemberSkills(created.member.id);
    assert.equal(memberSkills.length, 0, "软删除技能不得出现在成员技能列表");
    const active = await skillService.listActive();
    assert.equal(
      active.some((skill) => skill.id === target.id),
      false,
    );
  } finally {
    await db.skill.update({ where: { id: target.id }, data: { deletedAt: null } });
  }
});

// ---------------------------------------------------------------------------
// HTTP 契约：统一信封、私有缓存与字段固定
// ---------------------------------------------------------------------------

/**
 * 直接调用路由处理函数，而不是起一个 next server。
 *
 * 本仓库没有 HTTP 测试基础设施，而 M3 的契约风险集中在「信封 + 缓存头 + 字段集」，
 * 这三者都由 `apiSuccess` / 路由模块决定，因此直接 import 路由并传入 `Request`
 * 就能覆盖真实行为，且不引入新的依赖或端口。
 */
async function createSessionToken(userId: string): Promise<string> {
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const now = new Date();
  // `memberService.create` 会按开户流程把新账号标为「必须改密」，
  // 而 `authenticateRequest` 对这种账号一律抛 PASSWORD_CHANGE_REQUIRED (403)。
  // 这里模拟「已完成首次改密」的正常成员，才能测到真正的业务分支。
  await getDb().passwordCredential.updateMany({
    where: { userId },
    data: { mustChangePassword: false, passwordChangedAt: now },
  });
  await getDb().authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  return token;
}

async function callRoute(
  handler: (request: Request, context?: never) => Promise<Response>,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown>; cacheControl: string | null }> {
  const parsed = new URL(url);
  const request = new Request(url, {
    method: init.method ?? "GET",
    headers: {
      // 写接口会走 assertSameOrigin()，它要求 origin 与 host 同时存在且一致。
      // undici 的 Request 不允许手工覆盖 `host`（会被剥离），因此这里给
      // assertSameOrigin 优先读取的 `x-forwarded-host`。
      origin: parsed.origin,
      "x-forwarded-host": parsed.host,
      host: parsed.host,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const response = await handler(request);
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json, cacheControl: response.headers.get("cache-control") };
}

dbTest("M3 受保护接口无 Cookie 时返回 401 且不泄漏任何字段", async () => {
  const { GET } = await import("../../src/app/api/v1/member/dashboard/route");
  const result = await callRoute(GET, "http://localhost/api/v1/member/dashboard");

  assert.equal(result.status, 401);
  assert.equal(result.json.success, false);
  const error = result.json.error as { code: string };
  assert.equal(error.code, "UNAUTHENTICATED");
  // 失败响应也必须带 requestId，便于按请求追踪。
  assert.equal(typeof (result.json.meta as { requestId: string }).requestId, "string");
  // 未认证响应绝不能携带业务字段。
  assert.equal("data" in result.json, false);
});

dbTest("M3 成员接口响应信封固定为 success/data/meta 且带私有缓存头", async () => {
  const created = await createMember("信封");
  const token = await createSessionToken(created.member.userId);

  const { GET: dashboardGET } = await import("../../src/app/api/v1/member/dashboard/route");
  const result = await callRoute(dashboardGET, "http://localhost/api/v1/member/dashboard", {
    headers: { cookie: `pc_hospital_session=${token}` },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  // 成员数据一律私有，禁止共享缓存（任务书 §10.5）。
  assert.equal(result.cacheControl, "private, no-store");

  const data = result.json.data as Record<string, unknown>;
  // 字段集必须与冻结契约逐字一致，多一个字段都可能泄漏内部信息。
  // `degraded` 是 M3 修订后新增的显式契约字段：列出加载失败的区块，
  // 用于页面做「局部错误」而不是整页失败（任务书 §12.1）。
  assert.deepEqual(Object.keys(data).sort(), [
    "degraded",
    "favorites",
    "notifications",
    "profile",
    "ranking",
    "recentActivity",
    "recentRepairs",
    "repairSummary",
    "workQueue",
  ]);
  // 全部成功时降级清单为空 —— 不能拿它当「有区块失败」的常驻标记。
  assert.deepEqual(data.degraded, []);
  // 摘要视图不得出现 QQ / userId。
  assert.doesNotMatch(JSON.stringify(data), /"qq"|"userId"|"studentId"|"className"/);
  const notifications = data.notifications as {
    available: boolean;
    unreadCount: number;
    latest: unknown[];
  };
  const favorites = data.favorites as { available: boolean; count: number; latest: unknown[] };
  assert.equal(notifications.available, true);
  assert.equal(typeof notifications.unreadCount, "number");
  assert.equal(Array.isArray(notifications.latest), true);
  assert.equal(favorites.available, true);
  assert.equal(typeof favorites.count, "number");
  assert.equal(Array.isArray(favorites.latest), true);
  // M5 排行接入后契约稳定：字段集仍为最小集合，且不含任何身份字段。
  const ranking = data.ranking as {
    available: boolean;
    status: string | null;
    scope: string;
    metric: string;
    leaders: unknown[];
    currentMember: unknown;
  };
  assert.equal(ranking.available, true);
  assert.equal(ranking.scope, "TERM");
  assert.equal(ranking.metric, "REPAIR_COUNT");
  assert.equal(Array.isArray(ranking.leaders), true);
  assert.deepEqual(Object.keys(ranking).sort(), [
    "available",
    "currentMember",
    "generatedAt",
    "leaders",
    "metric",
    "scope",
    "status",
  ]);
});

dbTest("M3 越权字段被拒而不是被静默忽略", async () => {
  const created = await createMember("越权");
  const token = await createSessionToken(created.member.userId);

  const actor = memberActor(created.member.userId, "req_m3_extra_field");
  const current = await memberProfileService.getSelf(actor);

  const { PATCH } = await import("../../src/app/api/v1/member/profile/route");
  const result = await callRoute(PATCH, "http://localhost/api/v1/member/profile", {
    method: "PATCH",
    headers: { cookie: `pc_hospital_session=${token}` },
    body: { nickname: "越权测试", version: current.profile.version, realName: "不应被接受" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.json.success, false);
  // 关键：实名必须保持原值，越权字段不能悄悄生效。
  const after = await memberProfileService.getSelf(actor);
  assert.equal(after.profile.realName, "M3 越权");
});

// ---------------------------------------------------------------------------
// Code review 回归：本次修复的四处缺陷
//
// 这些用例是对抗性的：如果拿掉修复，它们必须失败。
// ---------------------------------------------------------------------------

dbTest("回归：个人主页摘要与工作台使用同一日期口径（本月/本学期不再恒为空）", async () => {
  const created = await createMember("主页口径");
  const actor = memberActor(created.member.userId, "req_m3_profile_range");
  const today = new Date().toISOString().slice(0, 10);

  // 配置一个覆盖今天的学期，让 termApprovedCount 有可比对的口径。
  const year = Number(today.slice(0, 4));
  process.env.ACADEMIC_TERM_START = `${year}-01-01`;
  process.env.ACADEMIC_TERM_END = `${year}-12-31`;
  resetAcademicTermConfigForTests();

  try {
    await createApprovedRepair(actor, { repairDate: today, durationMinutes: 50 });

    const self = await memberProfileService.getSelf(actor);
    const dashboard = await memberDashboardService.getDashboard(actor);

    // 修复前：listMemberRepairSummary 未传区间 → month 恒为 0、term 恒为 UNCONFIGURED。
    assert.equal(self.repairSummary.monthApprovedCount.value, 1, "个人主页本月计数必须真实");
    assert.equal(self.repairSummary.termApprovedCount.status, "AVAILABLE");
    assert.equal(self.repairSummary.termApprovedCount.value, 1, "个人主页学期计数必须真实");

    // 两个入口的日期口径必须完全一致（同一次调用窗口内）。
    assert.deepEqual(
      self.repairSummary.monthApprovedCount,
      dashboard.repairSummary.monthApprovedCount,
    );
    assert.deepEqual(
      self.repairSummary.termApprovedCount,
      dashboard.repairSummary.termApprovedCount,
    );

    // 他人内部主页走同一条修复路径，同样不得退回 0 / UNCONFIGURED。
    const viewer = await createMember("主页口径查看者");
    const viewerActor = memberActor(viewer.member.userId, "req_m3_profile_range_viewer");
    const internal = await memberProfileService.getInternal(created.member.id, viewerActor);
    assert.equal(internal.repairSummary.monthApprovedCount.value, 1);
    assert.equal(internal.repairSummary.termApprovedCount.value, 1);
  } finally {
    delete process.env.ACADEMIC_TERM_START;
    delete process.env.ACADEMIC_TERM_END;
    resetAcademicTermConfigForTests();
  }
});

dbTest("回归：技能审计 before 记录的是移除前的真实集合，而不是空数组", async () => {
  const created = await createMember("审计集合");
  const actor = memberActor(created.member.userId, "req_m3_audit_before");
  const active = await skillService.listActive();
  const [a, b, c] = active;
  assert.ok(a && b && c, "Seed 技能不足以覆盖该用例");

  const { PUT } = await import("../../src/app/api/v1/member/profile/skills/route");
  const token = await createSessionToken(created.member.userId);

  async function putSkills(skillIds: string[]): Promise<void> {
    const current = await memberProfileService.getSelf(actor);
    const result = await callRoute(PUT, "http://localhost/api/v1/member/profile/skills", {
      method: "PUT",
      headers: { cookie: `pc_hospital_session=${token}` },
      body: { skillIds, profileVersion: current.profile.version },
    });
    assert.equal(result.status, 200, JSON.stringify(result.json));
  }

  // 第一次：关联 a + b
  await putSkills([a.id, b.id]);
  // 第二次：只留 a，移除 b 并新增 c
  await putSkills([a.id, c.id]);

  const audits = await getDb().auditLog.findMany({
    where: { action: "MEMBER_SKILLS_UPDATED", targetId: created.member.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(audits.length, 2);

  const second = audits[1];
  const before = (second.beforeSummary as { skillCodes?: string[] } | null)?.skillCodes ?? [];
  const after = (second.afterSummary as { skillCodes?: string[] } | null)?.skillCodes ?? [];

  // 修复前 beforeCodes 从只含 desired 的 skillRows 过滤 → 恒为 []。
  assert.equal(before.length, 2, `before 必须包含变更前的两个技能，实际 ${JSON.stringify(before)}`);
  assert.deepEqual([...before].sort(), [a.code, b.code].sort());
  assert.deepEqual([...after].sort(), [a.code, c.code].sort());
  // b 属于「被移除」的旧技能，必须出现在 before 而不在 after。
  assert.equal(before.includes(b.code), true);
  assert.equal(after.includes(b.code), false);

  // 幂等重放：集合未变时 before 与 after 相同，且不产生多余审计。
  await putSkills([a.id, c.id]);
  const replayAudits = await getDb().auditLog.findMany({
    where: { action: "MEMBER_SKILLS_UPDATED", targetId: created.member.id },
    orderBy: { createdAt: "asc" },
  });
  const last = replayAudits[replayAudits.length - 1];
  const replayBefore = (last.beforeSummary as { skillCodes?: string[] } | null)?.skillCodes ?? [];
  assert.deepEqual([...replayBefore].sort(), [a.code, c.code].sort());
});

dbTest("回归：单路查询失败只降级该区块，其余区块照常返回真实数据", async () => {
  const created = await createMember("局部降级");
  const actor = memberActor(created.member.userId, "req_m3_degrade");
  const today = new Date().toISOString().slice(0, 10);
  await createApprovedRepair(actor, { repairDate: today, durationMinutes: 20 });

  // `collectSections` 是 provider 收敛 `allSettled` 结果的纯函数出口，
  // 直接喂入「一路 rejected、三路 fulfilled」即可验证降级语义，
  // 不需要 monkey-patch ESM 模块（那在 ESM 下不可行）。
  const { collectSections, resolveMemberRanges } =
    await import("../../src/features/member-dashboard/member-overview-provider");

  const summary = {
    totalApprovedCount: { value: 1, status: "AVAILABLE" as const },
    termApprovedCount: { value: null, status: "UNCONFIGURED" as const },
    monthApprovedCount: { value: 1, status: "AVAILABLE" as const },
    totalApprovedDurationMinutes: { value: 20, status: "AVAILABLE" as const },
    source: "M2_APPROVED_REPAIRS" as const,
    generatedAt: new Date().toISOString(),
  };
  const repairs: never[] = [];
  const activity: never[] = [];

  const sections = collectSections([
    { status: "fulfilled", value: summary },
    { status: "fulfilled", value: repairs },
    { status: "fulfilled", value: activity },
    { status: "rejected", reason: Object.assign(new Error("boom"), { code: "DB_UNAVAILABLE" }) },
  ]);

  // 关键：一路失败不得让另外三路一起变成错误（这正是 `Promise.all` 的行为）。
  assert.equal(sections.allFailed, false);
  assert.equal(sections.repairSummary.status, "ready");
  assert.equal(sections.recentRepairs.status, "ready");
  assert.equal(sections.recentActivity.status, "ready");
  assert.equal(sections.workQueue.status, "failed");
  // 失败区块不携带数据，且错误码被收敛为稳定字符串。
  assert.deepEqual(sections.workQueue, { status: "failed", code: "DB_UNAVAILABLE" });
  if (sections.repairSummary.status === "ready") {
    assert.deepEqual(sections.repairSummary.data, summary);
  }

  // 全失败时才置 allFailed，供页面整块报错。
  const allBad = collectSections([
    { status: "rejected", reason: new Error("x") },
    { status: "rejected", reason: new Error("x") },
    { status: "rejected", reason: new Error("x") },
    { status: "rejected", reason: new Error("x") },
  ]);
  assert.equal(allBad.allFailed, true);
  // 非 AppError 的异常也要收敛成稳定码，不能把原始 message 透给前端。
  assert.deepEqual(allBad.repairSummary, { status: "failed", code: "OVERVIEW_SECTION_FAILED" });

  // 真实调用路径：全部成功时 degraded 为空。
  const { loadMemberOverview } =
    await import("../../src/features/member-dashboard/member-overview-provider");
  const overview = await loadMemberOverview({
    memberProfileId: created.member.id,
    now: new Date(),
    recentLimit: 5,
  });
  assert.equal(overview.allFailed, false);
  assert.equal(overview.repairSummary.status, "ready");
  assert.equal(overview.workQueue.status, "ready");
  assert.equal(overview.recentRepairs.status, "ready");
  assert.equal(overview.recentActivity.status, "ready");
  // 日期口径解析在工作台与个人主页之间必须一致。
  const ranges = resolveMemberRanges(new Date());
  assert.ok(ranges.monthRange.endExclusive > ranges.monthRange.startInclusive);

  const dashboard = await memberDashboardService.getDashboard(actor);
  assert.deepEqual(dashboard.degraded, []);
  assert.equal(dashboard.repairSummary.monthApprovedCount.value, 1);
});
