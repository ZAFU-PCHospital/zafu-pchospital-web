import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { repairExportService } from "../../src/features/admin/repair-export-service";
import { analyticsService } from "../../src/features/analytics/analytics-service";
import { memberService } from "../../src/features/members/member-service";
import { repairAdminService } from "../../src/features/repairs/repair-admin-service";
import { repairCategoryService } from "../../src/features/repairs/repair-category-service";
import { repairPhotoService } from "../../src/features/repairs/repair-photo-service";
import { repairQueryService } from "../../src/features/repairs/repair-query-service";
import { repairReviewService } from "../../src/features/repairs/repair-review-service";
import { repairService } from "../../src/features/repairs/repair-service";
import { skillService } from "../../src/features/skills/skill-service";
import { AppError, type ApiErrorCode } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor, MemberListEntry } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * M6 管理后台集成测试（真实 GreatSQL）。
 *
 * 独立 UUID 段 `e6000000-…` 与 realName 前缀 "M6 " —— 清理一律按这两者限定，
 * 绝不触碰库里已有的真实开发数据（例如开发者自己 bootstrap 的管理员账号）。
 *
 * 覆盖重点：
 * - 权限边界：普通成员调任何管理端方法都必须被服务端拒绝（需求 §41）；
 * - M6 验收主流程：创建成员 → 成员提交维修 → 管理员审核 → 进入正式统计；
 * - 审计：详情查看明文、编辑、角色变更、批量操作、导出都必须留痕；
 * - 回归：**纯管理员（无成员档案）必须能列出维修记录**（修复前是 403 MEMBER_REQUIRED）。
 */
const ADMIN_USER_ID = "e6000000-0000-4000-8000-000000000001";
const ADMIN_PROFILE_ID = "e6000000-0000-4000-8000-000000000002";
const CATEGORY_ID = "e6000000-0000-4000-8000-000000000003";
const CATEGORY_CODE = "M6_TEST";

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: ADMIN_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m6_integration_admin",
};

function memberActor(userId: string): AuthorizedActor {
  return {
    actorType: "USER",
    userId,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["MEMBER"]),
    requestId: "req_m6_integration_member",
  };
}

async function testUserIds(): Promise<string[]> {
  const profiles = await getDb().memberProfile.findMany({
    where: { realName: { startsWith: "M6 " } },
    select: { userId: true },
  });
  return [...new Set([ADMIN_USER_ID, ...profiles.map((row) => row.userId)])];
}

/** 按外键依赖顺序清理本次测试产生的全部数据。 */
async function prepareFixtures(): Promise<void> {
  const db = getDb();
  const userIds = await testUserIds();
  const profiles = await db.memberProfile.findMany({
    where: { OR: [{ realName: { startsWith: "M6 " } }, { id: ADMIN_PROFILE_ID }] },
    select: { id: true },
  });
  const profileIds = profiles.map((row) => row.id).concat(ADMIN_PROFILE_ID);
  const records = { memberProfileId: { in: profileIds } };

  // 审计日志对 User 是 Restrict 外键，必须先于用户删除。
  await db.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { targetId: { in: [...userIds, ...profileIds] } }],
    },
  });
  await db.notification.deleteMany({
    where: {
      OR: [
        { recipientMemberProfileId: { in: profileIds } },
        { actorMemberProfileId: { in: profileIds } },
        { recipient: { realName: { startsWith: "M6 " } } },
        { actor: { realName: { startsWith: "M6 " } } },
      ],
    },
  });
  await db.repairComment.updateMany({
    where: { record: records },
    data: { parentCommentId: null },
  });
  await db.commentMention.deleteMany({ where: { comment: { record: records } } });
  await db.repairComment.deleteMany({ where: { record: records } });
  await db.repairFavorite.deleteMany({ where: { memberProfileId: { in: profileIds } } });
  await db.repairTimelineEvent.deleteMany({ where: { record: records } });
  await db.repairReview.deleteMany({ where: { record: records } });
  await db.repairPhoto.deleteMany({ where: { record: records } });
  await db.repairRecord.deleteMany({ where: records });
  await db.userSkill.deleteMany({ where: { memberProfileId: { in: profileIds } } });
  await db.accountProvision.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { memberProfileId: { in: profileIds } }] },
  });
  await db.inviteCodeRedemption.deleteMany({ where: { userId: { in: userIds } } });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profileIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.repairCategory.deleteMany({ where: { code: { startsWith: "M6_" } } });

  const now = new Date();
  await db.user.create({
    data: {
      id: ADMIN_USER_ID,
      status: "ACTIVE",
      displayName: "M6 Admin",
      createdAt: now,
      updatedAt: now,
    },
  });
  // 管理员**刻意不建成员档案**：这正是修复前导致 GET /admin/repairs 403 的场景。
  await db.repairCategory.create({
    data: {
      id: CATEGORY_ID,
      code: CATEGORY_CODE,
      name: "M6 测试分类",
      sortOrder: 1,
      createdAt: now,
    },
  });
}

before(async () => {
  if (!enabled) return;
  // 维修记录提交要求至少一张照片（M2 规则），因此集成测试需要隔离的上传目录。
  uploadTestRoot = await mkdtemp(join(tmpdir(), "pc-hospital-m6-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
  await prepareFixtures();
});
beforeEach(async () => {
  if (!enabled) return;
  await prepareFixtures();
});
after(async () => {
  if (!enabled) return;
  await disconnectDb();
  if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
});

let uploadTestRoot = "";

let seq = 0;
async function createMember(label: string) {
  seq += 1;
  const serial = `${Date.now()}`.slice(-5) + String(seq).padStart(3, "0");
  const result = await memberService.create(
    {
      realName: `M6 ${label}`,
      qq: `6${serial}`.slice(0, 11),
      phone: `139${serial}`.slice(0, 11),
      studentId: `S${serial}`,
      className: "M6 测试班",
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  const detail = await memberService.getDetail(result.member.id, ADMIN_ACTOR);
  return { ...result, entry: detail, owner: memberActor(result.member.userId) };
}

/** 建一条维修草稿并填好必填字段（返回草稿视图）。 */
async function draftRepair(owner: AuthorizedActor) {
  const draft = await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);
  return repairService.update(
    draft.id,
    {
      version: draft.version,
      repairDate: new Date().toISOString().slice(0, 10),
      durationMinutes: 30,
      categoryId: CATEGORY_ID,
      content: "M6 集成测试维修记录正文内容，用于覆盖管理端审核与导出。",
      result: "COMPLETED",
    },
    owner,
  );
}

/** 建一条 PENDING（已提交待审核）的维修记录。M2 要求提交前至少一张照片。 */
async function pendingRepair(owner: AuthorizedActor) {
  const updated = await draftRepair(owner);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await repairPhotoService.upload(
    updated.id,
    [new File([png], "m6-case.png", { type: "image/png" })],
    owner,
  );
  return repairService.submit(
    updated.id,
    { version: updated.version, idempotencyKey: randomUUID() },
    owner,
  );
}

async function auditActions(targetId: string): Promise<string[]> {
  const rows = await getDb().auditLog.findMany({
    where: { targetId },
    select: { action: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => row.action);
}

async function expectCode(run: () => Promise<unknown>, code: ApiErrorCode): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.equal(error instanceof AppError, true, `期望 AppError，实际 ${String(error)}`);
    assert.equal((error as AppError).code, code);
    return true;
  });
}

/* ------------------------------------------------------------ 权限边界 */

dbTest("普通成员调用任何管理端成员方法都被服务端拒绝", async () => {
  const { owner } = await createMember("权限边界");
  await expectCode(() => memberService.list({ page: 1, pageSize: 20 }, owner), "FORBIDDEN");
  await expectCode(() => memberService.getDetail(ADMIN_PROFILE_ID, owner), "FORBIDDEN");
  await expectCode(
    () => memberService.setRoles(ADMIN_PROFILE_ID, { roles: ["ADMIN"] }, owner),
    "FORBIDDEN",
  );
  await expectCode(
    () => memberService.batchSetEnabled({ memberIds: [ADMIN_PROFILE_ID], enabled: false }, owner),
    "FORBIDDEN",
  );
  await expectCode(
    () => memberService.setSkills(ADMIN_PROFILE_ID, { skillIds: [], profileVersion: 1 }, owner),
    "FORBIDDEN",
  );
  await expectCode(() => memberService.resetPassword(ADMIN_PROFILE_ID, owner), "FORBIDDEN");
});

dbTest("普通成员调用管理端维修方法与导出都被拒绝", async () => {
  const { owner } = await createMember("维修边界");
  const pending = await pendingRepair(owner);
  await expectCode(
    () => repairAdminService.updateRecord(pending.id, { version: 1, reason: "越权" }, owner),
    "FORBIDDEN",
  );
  await expectCode(
    () =>
      repairAdminService.batchReview(
        { recordIds: [pending.id], decision: "APPROVED", idempotencyKey: randomUUID() },
        owner,
      ),
    "FORBIDDEN",
  );
  await expectCode(
    () =>
      repairAdminService.updateFlags(pending.id, { isDifficult: true, isTypical: false }, owner),
    "FORBIDDEN",
  );
  await expectCode(() => repairExportService.export({}, "CSV", owner), "FORBIDDEN");
  await expectCode(() => repairCategoryService.listAll(owner), "FORBIDDEN");
  await expectCode(() => repairCategoryService.activate(CATEGORY_ID, owner), "FORBIDDEN");
});

dbTest("重复 QQ / 手机号不再「创建成功」：拒绝并保住原成员资料", async () => {
  const created = await createMember("重复号");
  const before = await memberService.getDetail(created.member.id, ADMIN_ACTOR);

  /* 回归：修复前这里会 201 且响应里没有 initialPassword ——
     `ensureMemberProfile` 复用了既有档案并覆盖 realName / studentId / className，
     `setInitialPassword` 又因为已有密码返回 false。管理员以为创建了新成员，
     实际把**另一位成员**的姓名与学号改掉了（浏览器实测踩到）。 */
  await assert.rejects(
    () =>
      memberService.create(
        {
          realName: "M6 重复号 二号",
          qq: before.qq!,
          phone: before.phone!,
          idempotencyKey: randomUUID(),
        },
        ADMIN_ACTOR,
      ),
    (error) => error instanceof AppError && error.code === "ACCOUNT_IDENTITY_CONFLICT",
  );

  const after = await memberService.getDetail(created.member.id, ADMIN_ACTOR);
  assert.equal(after.realName, before.realName, "原成员的姓名不能被覆盖");
  assert.equal(after.studentId, before.studentId, "原成员的学号不能被覆盖");
});

dbTest("回归：没有成员档案的纯管理员也能列出维修记录", async () => {
  const { owner } = await createMember("纯管理员");
  await pendingRepair(owner);
  // 该管理员没有任何 memberProfile —— 修复前这里会抛 MEMBER_REQUIRED。
  assert.equal(
    await getDb().memberProfile.count({ where: { userId: ADMIN_USER_ID } }),
    0,
    "前置条件：管理员不应有成员档案",
  );
  const page = await repairQueryService.list({ page: 1, pageSize: 20 }, ADMIN_ACTOR);
  assert.equal(page.items.length >= 1, true);
});

/* ------------------------------------------------------------ 成员管理 */

dbTest("成员列表脱敏，详情才返回明文，且详情读取写审计", async () => {
  const created = await createMember("脱敏");
  const list = await memberService.list({ page: 1, pageSize: 50, query: "M6 脱敏" }, ADMIN_ACTOR);
  const entry = list.items.find((item) => item.id === created.member.id);
  assert.ok(entry, "列表中应能查到刚创建的成员");
  const qq = created.entry.qq!;
  const phone = created.entry.phone!;
  assert.notEqual(entry.qqMasked, qq);
  assert.notEqual(entry.phoneMasked, phone);
  assert.equal(JSON.stringify(entry).includes(qq), false, "列表响应不得出现明文 QQ");
  assert.equal(JSON.stringify(entry).includes(phone), false, "列表响应不得出现明文手机号");

  const detail = await memberService.getDetail(created.member.id, ADMIN_ACTOR);
  assert.equal(detail.qq, qq);
  assert.equal(detail.phone, phone);
  const actions = await auditActions(created.member.id);
  assert.equal(actions.includes("member.detail.viewed"), true, `审计缺少详情查看：${actions}`);
});

dbTest("成员统计在禁用后仍可查看（管理端专用路径）", async () => {
  const created = await createMember("统计");
  const pending = await pendingRepair(created.owner);
  await repairReviewService.review(
    pending.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );
  const stats = await analyticsService.getMemberAnalyticsFor(created.member.id, ADMIN_ACTOR);
  assert.equal(stats.summary.totalApprovedCount.value, 1);

  await memberService.setEnabled(created.member.id, false, ADMIN_ACTOR);
  const afterDisable = await analyticsService.getMemberAnalyticsFor(created.member.id, ADMIN_ACTOR);
  assert.equal(afterDisable.summary.totalApprovedCount.value, 1, "禁用后历史统计仍应可查");
});

dbTest("编辑成员走乐观锁并写审计，版本冲突返回 409", async () => {
  const created = await createMember("编辑");
  const updated = await memberService.update(
    created.member.id,
    {
      realName: "M6 编辑后",
      studentId: "20260001",
      className: "M6 新班级",
      nickname: "小编",
      version: created.entry.version,
    },
    ADMIN_ACTOR,
  );
  assert.equal(updated.realName, "M6 编辑后");
  assert.equal(updated.nickname, "小编");
  const actions = await auditActions(created.member.id);
  assert.equal(actions.includes("member.profile.updated"), true, `审计缺少编辑：${actions}`);
  // 用旧版本号再提交一次必须冲突
  await expectCode(
    () =>
      memberService.update(
        created.member.id,
        { realName: "M6 并发", version: created.entry.version },
        ADMIN_ACTOR,
      ),
    "MEMBER_PROFILE_VERSION_CONFLICT",
  );
});

dbTest("设置角色：授予 ADMIN 后立即生效，并被审计；不允许撤销最后一个管理员", async () => {
  const created = await createMember("角色");
  const withAdmin = await memberService.setRoles(
    created.member.id,
    { roles: ["MEMBER", "ADMIN"] },
    ADMIN_ACTOR,
  );
  assert.deepEqual(withAdmin.roles, ["ADMIN", "MEMBER"]);
  const actions = await auditActions(created.member.id);
  assert.equal(actions.includes("member.roles.changed"), true, `审计缺少角色变更：${actions}`);

  // 撤销最后一个在册管理员必须被拒绝。库里本来没有管理员角色行，
  // 上面刚把该成员提为 ADMIN，因此「在册管理员数」此时只取决于基线。
  const baseline = await getDb().userRole.count({
    where: {
      revokedAt: null,
      role: { code: "ADMIN" },
      user: { status: "ACTIVE", deletedAt: null },
    },
  });
  if (baseline === 1) {
    await expectCode(
      () => memberService.setRoles(created.member.id, { roles: ["MEMBER"] }, ADMIN_ACTOR),
      "MEMBER_LAST_ADMIN",
    );
  } else {
    const demoted = await memberService.setRoles(
      created.member.id,
      { roles: ["MEMBER"] },
      ADMIN_ACTOR,
    );
    assert.deepEqual(demoted.roles, ["MEMBER"]);
  }
  // 不变量：任何路径都不得把在册管理员降到 0
  const remaining = await getDb().userRole.count({
    where: {
      revokedAt: null,
      role: { code: "ADMIN" },
      user: { status: "ACTIVE", deletedAt: null },
    },
  });
  assert.equal(remaining >= 1, true, "在册管理员数量不得变为 0");
});

dbTest("批量禁用允许部分成功，逐条返回稳定错误码；不能禁用自己的账号", async () => {
  const a = await createMember("批量甲");
  const b = await createMember("批量乙");
  const missingId = "e6000000-0000-4000-8000-0000000000ff";

  const result = await memberService.batchSetEnabled(
    { memberIds: [a.member.id, b.member.id, missingId], enabled: false },
    ADMIN_ACTOR,
  );
  assert.deepEqual(result.succeeded.sort(), [a.member.id, b.member.id].sort());
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]!.memberId, missingId);
  assert.equal(result.failed[0]!.code, "RESOURCE_NOT_FOUND");

  const listed = await memberService.list(
    { page: 1, pageSize: 50, status: "REVOKED" },
    ADMIN_ACTOR,
  );
  assert.equal(
    listed.items.some((item) => item.id === a.member.id),
    true,
  );

  // 自己禁自己必须被拒（否则会把自己的成员资格关掉却仍持管理员角色）
  const selfProfile = await getDb().memberProfile.create({
    data: {
      id: "e6000000-0000-4000-8000-0000000000ee",
      userId: ADMIN_USER_ID,
      realName: "M6 管理员本人",
      status: "ACTIVE",
      joinedAt: new Date(),
      createdAt: new Date(),
    },
  });
  await expectCode(
    () => memberService.setEnabled(selfProfile.id, false, ADMIN_ACTOR),
    "MEMBER_SELF_LOCKOUT",
  );
  await getDb().memberProfile.deleteMany({ where: { id: selfProfile.id } });

  const restored = await memberService.batchSetEnabled(
    { memberIds: [a.member.id], enabled: true },
    ADMIN_ACTOR,
  );
  assert.deepEqual(restored.succeeded, [a.member.id]);
});

dbTest("批量上限与空集合校验", async () => {
  await expectCode(
    () => memberService.batchSetEnabled({ memberIds: [], enabled: true }, ADMIN_ACTOR),
    "VALIDATION_FAILED",
  );
  const tooMany = Array.from(
    { length: 51 },
    (_, index) => `e6000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  await expectCode(
    () => memberService.batchSetEnabled({ memberIds: tooMany, enabled: true }, ADMIN_ACTOR),
    "MEMBER_BATCH_LIMIT_EXCEEDED",
  );
});

dbTest("管理员为成员设置技能标签：复用同一实现、上限 12、未知标签报错", async () => {
  const created = await createMember("技能");
  const skills = await skillService.listActive();
  assert.equal(skills.length > 0, true, "需要至少一个技能标签 fixture（Seed 提供）");
  const picked = skills.slice(0, 2).map((skill) => skill.id);

  const saved = await memberService.setSkills(
    created.member.id,
    { skillIds: picked, profileVersion: created.entry.version },
    ADMIN_ACTOR,
  );
  assert.equal(saved.skills.length, 2);
  const actions = await auditActions(created.member.id);
  assert.equal(actions.includes("MEMBER_SKILLS_UPDATED"), true);

  await expectCode(
    () =>
      memberService.setSkills(
        created.member.id,
        { skillIds: ["not-a-skill"], profileVersion: saved.version },
        ADMIN_ACTOR,
      ),
    "SKILL_NOT_FOUND",
  );
  await expectCode(
    () =>
      memberService.setSkills(
        created.member.id,
        { skillIds: Array.from({ length: 13 }, (_, i) => `s${i}`), profileVersion: saved.version },
        ADMIN_ACTOR,
      ),
    "SKILL_LIMIT_EXCEEDED",
  );
});

/* ------------------------------------------------------------ 维修管理 */

dbTest("M6 验收主流程：创建成员 → 提交维修 → 管理员审核通过 → 进入正式统计", async () => {
  const created = await createMember("验收");
  const pending = await pendingRepair(created.owner);
  assert.equal(pending.status, "PENDING");

  const approved = await repairReviewService.review(
    pending.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );
  assert.equal(approved.status, "APPROVED");
  const actions = await auditActions(pending.id);
  assert.equal(actions.includes("repair.approved"), true, `审计缺少审核：${actions}`);

  const stats = await analyticsService.getMemberAnalyticsFor(created.member.id, ADMIN_ACTOR);
  assert.equal(stats.summary.totalApprovedCount.value, 1, "审核通过后应进入正式统计");

  const entry = await memberService.list({ page: 1, pageSize: 20, query: "M6 验收" }, ADMIN_ACTOR);
  assert.equal(entry.items[0]!.approvedRepairCount, 1, "列表里的「已通过维修」应同步");
});

dbTest("管理员修改异常数据：原因必填、状态不变、写审计与时间线", async () => {
  const created = await createMember("改数据");
  const pending = await pendingRepair(created.owner);
  const approved = await repairReviewService.review(
    pending.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );

  await expectCode(
    () =>
      repairAdminService.updateRecord(
        approved.id,
        { version: approved.version, reason: "  " },
        ADMIN_ACTOR,
      ),
    "REPAIR_ADMIN_REASON_REQUIRED",
  );

  const updated = await repairAdminService.updateRecord(
    approved.id,
    {
      version: approved.version,
      reason: "成员填错了时长，管理员按现场记录修正",
      durationMinutes: 75,
    },
    ADMIN_ACTOR,
  );
  assert.equal(updated.durationMinutes, 75);
  assert.equal(updated.status, "APPROVED", "改数据不得改变审核状态");
  assert.equal(updated.version, approved.version + 1);
  const actions = await auditActions(approved.id);
  assert.equal(actions.includes("repair.admin.updated"), true, `审计缺少管理端改数据：${actions}`);

  await expectCode(
    () =>
      repairAdminService.updateRecord(
        approved.id,
        { version: approved.version, reason: "并发提交" },
        ADMIN_ACTOR,
      ),
    "REPAIR_VERSION_CONFLICT",
  );

  const timeline = await getDb().repairTimelineEvent.findMany({
    where: { repairRecordId: approved.id },
    select: { eventType: true },
  });
  assert.equal(timeline.filter((row) => row.eventType === "UPDATED").length >= 1, true);
});

dbTest("批量审核逐条复用单条路径：已审核的记录以状态冲突出现在失败项里", async () => {
  const created = await createMember("批量审核");
  const first = await pendingRepair(created.owner);
  const second = await pendingRepair(created.owner);
  const third = await pendingRepair(created.owner);
  await repairReviewService.review(
    third.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );

  const result = await repairAdminService.batchReview(
    {
      recordIds: [first.id, second.id, third.id],
      decision: "APPROVED",
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  assert.deepEqual(result.succeeded.sort(), [first.id, second.id].sort());
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]!.recordId, third.id);
  assert.equal(result.failed[0]!.code, "REPAIR_STATE_CONFLICT");
  const actions = await auditActions(first.id);
  assert.equal(actions.includes("repair.approved"), true);
});

dbTest("批量退回必须在入口就带原因，逐条结果可用于界面展示", async () => {
  const created = await createMember("批量退回");
  const record = await pendingRepair(created.owner);
  // 整批前置约束：缺原因时直接拒绝，而不是让每条记录各失败一次
  await expectCode(
    () =>
      repairAdminService.batchReview(
        { recordIds: [record.id], decision: "REJECTED", idempotencyKey: randomUUID() },
        ADMIN_ACTOR,
      ),
    "REPAIR_REJECTION_NOTE_REQUIRED",
  );
  const result = await repairAdminService.batchReview(
    {
      recordIds: [record.id],
      decision: "REJECTED",
      note: "记录里没有写清故障现象，请补充后重新提交",
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  assert.deepEqual(result.succeeded, [record.id]);
  const actions = await auditActions(record.id);
  assert.equal(actions.includes("repair.rejected"), true);
});

dbTest("软删除违规记录：从管理端列表与正式统计中同时消失", async () => {
  const created = await createMember("软删除");
  const pending = await pendingRepair(created.owner);
  const approved = await repairReviewService.review(
    pending.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );
  await repairService.softDelete(approved.id, "内容与事实不符，违规记录", ADMIN_ACTOR);

  const page = await repairQueryService.list(
    { page: 1, pageSize: 50, query: "M6 软删除" },
    ADMIN_ACTOR,
  );
  assert.equal(
    page.items.some((item) => item.id === approved.id),
    false,
  );
  const stats = await analyticsService.getMemberAnalyticsFor(created.member.id, ADMIN_ACTOR);
  assert.equal(stats.summary.totalApprovedCount.value, 0, "软删除后不得再计入正式统计");
  const actions = await auditActions(approved.id);
  assert.equal(actions.includes("repair.deleted"), true);
});

/* ------------------------------------------------------------ 分类 */

dbTest("分类管理：重复 code 报 409、列表带引用计数、停用与重新启用", async () => {
  await expectCode(
    () => repairCategoryService.create({ code: CATEGORY_CODE, name: "重复分类" }, ADMIN_ACTOR),
    "REPAIR_CATEGORY_CODE_CONFLICT",
  );

  const created = await createMember("分类");
  const pending = await pendingRepair(created.owner);
  const list = await repairCategoryService.listAll(ADMIN_ACTOR);
  const row = list.find((item) => item.id === CATEGORY_ID);
  assert.ok(row, "管理端列表必须包含本次 fixture 分类");
  assert.equal(row.usedByRepairCount >= 1, true, "应统计到引用该分类的记录数");

  const deactivated = await repairCategoryService.deactivate(CATEGORY_ID, ADMIN_ACTOR);
  assert.equal(deactivated.isActive, false);
  const afterDeactivate = await repairCategoryService.listAll(ADMIN_ACTOR);
  assert.equal(afterDeactivate.find((item) => item.id === CATEGORY_ID)?.isActive, false);
  // 公开列表只给启用中的分类
  const publicList = await repairCategoryService.list();
  assert.equal(
    publicList.some((item) => item.id === CATEGORY_ID),
    false,
  );

  await expectCode(
    () => repairCategoryService.deactivate("e6000000-0000-4000-8000-0000000000dd", ADMIN_ACTOR),
    "RESOURCE_NOT_FOUND",
  );

  const activated = await repairCategoryService.activate(CATEGORY_ID, ADMIN_ACTOR);
  assert.equal(activated.isActive, true);
  const actions = await auditActions(CATEGORY_ID);
  assert.equal(actions.includes("repair.category.activated"), true, `审计缺少启用：${actions}`);
  assert.equal(pending.status, "PENDING");
});

/* ------------------------------------------------------------ 导出 */

dbTest("导出 CSV：表头、成员姓名、BOM 与审计；XLSX 产出 ZIP 容器", async () => {
  const created = await createMember("导出");
  const pending = await pendingRepair(created.owner);
  await repairReviewService.review(
    pending.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );

  const csv = await repairExportService.export({ query: "M6 导出" }, "CSV", ADMIN_ACTOR);
  assert.equal(csv.format, "CSV");
  assert.equal(csv.contentType.startsWith("text/csv"), true);
  assert.equal(csv.fileName.endsWith(".csv"), true);
  assert.deepEqual([...csv.body.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv.body);
  assert.equal(text.includes("维修日期"), true);
  assert.equal(text.includes("M6 导出"), true);
  assert.equal(csv.rowCount >= 1, true);

  const xlsx = await repairExportService.export({ query: "M6 导出" }, "XLSX", ADMIN_ACTOR);
  assert.equal(xlsx.fileName.endsWith(".xlsx"), true);
  // ZIP local file header：PK\x03\x04
  assert.deepEqual([...xlsx.body.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(
    xlsx.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  const audits = await getDb().auditLog.findMany({
    where: { action: "repair.exported", actorUserId: ADMIN_USER_ID },
    select: { id: true },
  });
  assert.equal(audits.length >= 2, true, "每次导出都必须留痕");
});

dbTest("导出只包含筛选命中的记录（与列表同一套谓词）", async () => {
  const mine = await createMember("导出范围甲");
  const other = await createMember("导出范围乙");
  const a = await pendingRepair(mine.owner);
  await pendingRepair(other.owner);
  await repairReviewService.review(
    a.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    ADMIN_ACTOR,
  );
  const csv = await repairExportService.export(
    { status: "PENDING", query: "M6 导出范围乙" },
    "CSV",
    ADMIN_ACTOR,
  );
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv.body);
  assert.equal(text.includes("M6 导出范围乙"), true);
  assert.equal(text.includes("M6 导出范围甲"), false);
});

/* ------------------------------------------------------------ 管理端列表筛选 */

dbTest("管理端维修列表支持状态与关键字筛选，且可见范围不受成员档案影响", async () => {
  const created = await createMember("筛选");
  const pending = await pendingRepair(created.owner);
  const draft = await draftRepair(created.owner);

  const pendingPage = await repairQueryService.list(
    { page: 1, pageSize: 50, status: "PENDING", query: "M6 筛选" },
    ADMIN_ACTOR,
  );
  assert.equal(
    pendingPage.items.every((item) => item.status === "PENDING"),
    true,
  );
  assert.equal(
    pendingPage.items.some((item) => item.id === pending.id),
    true,
  );
  assert.equal(
    pendingPage.items.some((item) => item.id === draft.id),
    false,
  );

  const all = await repairQueryService.list(
    { page: 1, pageSize: 50, query: "M6 筛选" },
    ADMIN_ACTOR,
  );
  assert.equal(all.items.length, 2, "管理员应看到草稿与待审核的全部记录");
});

dbTest("成员列表支持状态与角色筛选、分页元数据正确", async () => {
  const created = await createMember("分页");
  await memberService.setRoles(created.member.id, { roles: ["MEMBER", "ADMIN"] }, ADMIN_ACTOR);

  const byRole = await memberService.list(
    { page: 1, pageSize: 20, role: "ADMIN", query: "M6 分页" },
    ADMIN_ACTOR,
  );
  assert.equal(byRole.items.length, 1);
  assert.equal(byRole.items[0]!.roles.includes("ADMIN"), true);
  assert.equal(byRole.pagination.total, 1);

  const byMember = await memberService.list(
    { page: 1, pageSize: 20, role: "MEMBER", query: "M6 分页" },
    ADMIN_ACTOR,
  );
  assert.equal(byMember.items.length, 1, "该成员同时持有两个角色，按 MEMBER 也应命中");

  const empty = await memberService.list(
    { page: 1, pageSize: 20, query: "不存在的成员名字" },
    ADMIN_ACTOR,
  );
  assert.equal(empty.items.length, 0);
  assert.equal(empty.pagination.total, 0);
});

dbTest("成员列表条目字段集稳定（QQ/手机号只出现脱敏形式）", async () => {
  await createMember("字段集");
  const page = await memberService.list({ page: 1, pageSize: 5, query: "M6 字段集" }, ADMIN_ACTOR);
  const entry = page.items[0]!;
  assert.deepEqual(
    Object.keys(entry).sort(),
    [
      "approvedRepairCount",
      "approvedRepairMinutes",
      "className",
      "id",
      "joinedAt",
      "nickname",
      "phoneMasked",
      "qqMasked",
      "realName",
      "roles",
      // 第六轮验收：列表要能直接显示「这个人会什么」，技能标签随列表返回
      "skills",
      "status",
      "studentId",
      "userId",
      "userStatus",
      "version",
    ].sort(),
  );
  const typed: MemberListEntry = entry;
  assert.equal(typed.status, "ACTIVE");
  // 新建成员身上还没有技能标签，但字段本身必须在（界面按「未登记」渲染）
  assert.deepEqual(typed.skills, []);
  // 维修统计同样是列表字段：次数与总时长一起给，界面在同一格里显示
  assert.equal(typed.approvedRepairCount, 0);
  assert.equal(typed.approvedRepairMinutes, 0);

  // 挂上标签后，列表里应当按标签库顺序带出来（界面直接显示，不必打开详情）
  const skillRows = await getDb().skill.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    take: 2,
  });
  await memberService.setSkills(
    entry.id,
    { skillIds: skillRows.map((row) => row.id).reverse(), profileVersion: entry.version },
    ADMIN_ACTOR,
  );
  const withSkills = await memberService.list(
    { page: 1, pageSize: 5, query: "M6 字段集" },
    ADMIN_ACTOR,
  );
  assert.deepEqual(
    withSkills.items[0]!.skills.map((skill) => skill.id),
    skillRows.map((row) => row.id),
    "技能标签应当按标签库的 sortOrder 顺序带出来",
  );
  // 列表里**不含**明文联系方式：技能是展示信息，QQ / 手机号仍然只在详情接口给明文
  assert.equal(Object.hasOwn(withSkills.items[0]!, "qq"), false);
});
