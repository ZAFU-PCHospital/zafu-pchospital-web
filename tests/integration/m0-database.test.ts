import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inviteCodeService } from "../../src/features/invitations/invite-code-service";
import { joinApplicationService } from "../../src/features/recruitment/join-application-service";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { authService } from "../../src/features/auth/auth-service";
import { memberService } from "../../src/features/members/member-service";
import { AppError } from "../../src/lib/api/errors";
import { authenticateRequest, SESSION_COOKIE_NAME } from "../../src/lib/auth/request";
import { repairService } from "../../src/features/repairs/repair-service";
import {
  createRepairPhotoService,
  repairPhotoService,
} from "../../src/features/repairs/repair-photo-service";
import {
  repairQueryService,
  listApprovedRepairsForAnalytics,
} from "../../src/features/repairs/repair-query-service";
import { repairReviewService } from "../../src/features/repairs/repair-review-service";
import { assertDestructiveDbAllowed } from "./db-guard";

const enabled = process.env.RUN_DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db";
const dbTest = enabled ? test : test.skip;
const adminId = "10000000-0000-4000-8000-000000000001";
let uploadTestRoot = "";

before(async () => {
  if (!enabled) return;
  // 这个文件的第一件事是**整表清空**（身份、口令、档案、审计……），所以先过闸门：
  // 本地 .env 的 DATABASE_URL 指向开发库，直接跑会把开发库的所有账号打成「有用户没身份」。
  assertDestructiveDbAllowed();
  uploadTestRoot = await mkdtemp(join(tmpdir(), "pc-hospital-m2-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
  const db = getDb();
  // M4 子表必须先于 repair_records / member_profiles 清空，否则 FK RESTRICT 会挡住全表清理。
  await db.notification.deleteMany();
  await db.commentMention.deleteMany();
  // `repair_comments.parent_comment_id` 是**自引用**外键（回复 → 根评论，ON DELETE RESTRICT）。
  // 一条 `DELETE` 会在删除根评论时被尚未删掉的回复挡住，报
  // `Foreign key constraint violated on (parent_comment_id)`。
  // 因此按「先回复、后根评论」两步删，而不是用 FOREIGN_KEY_CHECKS=0 绕过约束检查。
  await db.repairComment.deleteMany({ where: { parentCommentId: { not: null } } });
  await db.repairComment.deleteMany({ where: { parentCommentId: null } });
  await db.repairFavorite.deleteMany();
  await db.repairTimelineEvent.deleteMany();
  await db.repairReview.deleteMany();
  await db.repairPhoto.deleteMany();
  await db.repairRecord.deleteMany();
  await db.repairCategory.deleteMany();
  await db.authSession.deleteMany();
  await db.loginThrottle.deleteMany();
  await db.auditLog.deleteMany();
  await db.accountProvision.deleteMany();
  await db.inviteCodeRedemption.deleteMany();
  await db.inviteCode.deleteMany();
  await db.joinApplicationReview.deleteMany();
  await db.joinApplication.deleteMany();
  await db.passwordCredential.deleteMany();
  // M3 引入 user_skills（FK → member_profiles / skills）。
  // 本文件按全表清空 + 重建 fixture 的方式隔离数据，若不清 user_skills，
  // 在 M3 测试先跑（同进程顺序执行、共享库）时会残留引用，
  // 导致 memberProfile.deleteMany() 报 `member_profile_id` 外键冲突。
  // 保持 deleteMany 相对顺序即可保证父表在子表之后删除。
  await db.userSkill.deleteMany();
  await db.userRole.deleteMany();
  await db.memberProfile.deleteMany();
  await db.userIdentity.deleteMany();
  // `skills` 与 `roles` 一样是**共享 seed 数据，刻意不删**（只补不存在的 code）。
  // 但 `skills.created_by` 是可空外键且 `onDelete: Restrict`：只要有任意一行技能
  // 带着创建者（测试、预览脚本或历史运行留下的），全表清空 `users` 就会被外键挡住，
  // 表现为 `user.deleteMany()` 报 `Foreign key constraint violated on (created_by)`。
  // 这里只**解绑引用**、不删除技能本身 —— 既保住共享 seed，又让清理对所有残留状态都成立。
  await db.skill.updateMany({ where: { createdBy: { not: null } }, data: { createdBy: null } });
  await db.user.deleteMany();
  await db.user.create({
    data: {
      id: adminId,
      status: "ACTIVE",
      displayName: "M0 Admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await db.memberProfile.create({
    data: {
      id: "10000000-0000-4000-8000-000000000002",
      userId: adminId,
      realName: "M0 Admin",
      status: "ACTIVE",
      joinedAt: new Date(),
      createdAt: new Date(),
    },
  });
  await db.repairCategory.create({
    data: {
      // 测试专用 UUID 段（9xxxxxxx），避免与 seed 的 10000000-… 段冲突。
      // 注意：M3 seed 使用 10000000-…-0003 作为 SYSTEM 分类，这里若继续占用会撞主键。
      id: "90000000-0000-4000-8000-000000000003",
      code: "M2_TEST",
      name: "M2 测试分类",
      sortOrder: 1,
      createdAt: new Date(),
    },
  });
});

after(async () => {
  if (enabled) {
    await disconnectDb();
    if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
  }
});

const adminActor = {
  actorType: "USER" as const,
  userId: adminId,
  userStatus: "ACTIVE" as const,
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m0_test",
};

dbTest("基础角色 Seed 重复语义保持幂等", async () => {
  const db = getDb();
  for (let run = 0; run < 2; run += 1) {
    await db.role.upsert({
      where: { code: "MEMBER" },
      update: { name: "成员" },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        code: "MEMBER",
        name: "成员",
        createdAt: new Date(),
      },
    });
    await db.role.upsert({
      where: { code: "ADMIN" },
      update: { name: "管理员" },
      create: {
        id: "00000000-0000-4000-8000-000000000002",
        code: "ADMIN",
        name: "管理员",
        createdAt: new Date(),
      },
    });
  }
  assert.equal(await db.role.count({ where: { code: { in: ["MEMBER", "ADMIN"] } } }), 2);
});

dbTest("重复报名返回原回执且不重复写入", async () => {
  const suffix = randomUUID().replace(/\D/g, "").slice(0, 5).padEnd(5, "1");
  const input = {
    recruitmentCycle: `M0-${randomUUID().slice(0, 8)}`,
    realName: "测试报名者",
    qq: `6${suffix}12345`.slice(0, 10),
    phone: `139${suffix.padEnd(8, "2")}`.slice(0, 11),
    privacyConsent: true,
  };
  const first = await joinApplicationService.submit(input, { requestId: "req_join_1" });
  const replay = await joinApplicationService.submit(input, { requestId: "req_join_2" });
  assert.equal(replay.id, first.id);
  assert.equal(replay.duplicate, true);
  assert.equal(
    await getDb().joinApplication.count({ where: { recruitmentCycle: input.recruitmentCycle } }),
    1,
  );
  const listed = await joinApplicationService.list(
    { page: 1, pageSize: 20, status: "SUBMITTED", query: input.qq },
    adminActor,
  );
  assert.equal(listed.pagination.total, 1);
  assert.equal(listed.items[0]?.ticketNo, first.ticketNo);
  assert.notEqual(listed.items[0]?.qqMasked, input.qq);
  assert.notEqual(listed.items[0]?.phoneMasked, input.phone);
});

dbTest("面试通过重复执行不创建重复账号、档案或角色", async () => {
  const input = {
    recruitmentCycle: `REVIEW-${randomUUID().slice(0, 8)}`,
    realName: "测试成员",
    qq: `7${Date.now()}`.slice(0, 10),
    phone: `138${String(Date.now()).slice(-8)}`,
    privacyConsent: true,
  };
  const receipt = await joinApplicationService.submit(input, { requestId: "req_review_submit" });
  const review = {
    applicationId: receipt.id,
    result: "PASSED" as const,
    interviewedAt: new Date().toISOString(),
    idempotencyKey: `join-${receipt.id}`,
  };
  await joinApplicationService.review(review, adminActor);
  await joinApplicationService.review(review, adminActor);
  const provision = await getDb().accountProvision.findUniqueOrThrow({
    where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: receipt.id } },
  });
  assert.equal(provision.status, "SUCCEEDED");
  assert.equal(await getDb().memberProfile.count({ where: { userId: provision.userId! } }), 1);
  assert.equal(
    await getDb().userRole.count({ where: { userId: provision.userId!, revokedAt: null } }),
    1,
  );
});

dbTest("同一码可限次复用且 10 个并发请求不会超卖最后一个名额", async () => {
  const created = await inviteCodeService.create({ maxUses: 1 }, adminActor);
  const attempts = Array.from({ length: 10 }, (_, index) =>
    inviteCodeService.redeem(
      {
        code: created.plainCode,
        idempotencyKey: `redeem-${randomUUID()}`,
        realName: `并发成员${index}`,
        qq: `8${String(Date.now() + index).slice(-9)}`,
        phone: `137${String(Date.now() + index).slice(-8)}`,
        password: `M0-Test-Password-${index}`,
      },
      { requestId: `req_redeem_${index}` },
    ),
  );
  const settled = await Promise.allSettled(attempts);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  const stored = await getDb().inviteCode.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.usedCount, 1);
  assert.equal(
    await getDb().inviteCodeRedemption.count({ where: { inviteCodeId: created.id } }),
    1,
  );
  assert.equal(
    await getDb().accountProvision.count({
      where: { sourceType: "INVITE_REDEMPTION", status: "SUCCEEDED" },
    }),
    1,
  );
});

dbTest("管理员不能把最大次数调低到 usedCount 以下，也不能直接写 usedCount", async () => {
  const created = await inviteCodeService.create({ maxUses: 2 }, adminActor);
  await assert.rejects(() => inviteCodeService.update(created.id, { maxUses: 0 }, adminActor));
  const stored = await getDb().inviteCode.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.usedCount, 0);
  assert.equal(stored.maxUses, 2);
});

dbTest("报名通过发放的 QQ 身份可登录，首次改密会轮换并撤销旧 Session", async () => {
  const input = {
    recruitmentCycle: `AUTH-${randomUUID().slice(0, 8)}`,
    realName: "认证成员",
    qq: `9${String(Date.now()).slice(-9)}`,
    phone: `136${String(Date.now()).slice(-8)}`,
    privacyConsent: true,
  };
  const receipt = await joinApplicationService.submit(input, { requestId: "req_auth_submit" });
  const reviewed = await joinApplicationService.review(
    {
      applicationId: receipt.id,
      result: "PASSED",
      interviewedAt: new Date().toISOString(),
      idempotencyKey: `auth-${receipt.id}`,
    },
    adminActor,
  );
  const provision = await getDb().accountProvision.findUniqueOrThrow({
    where: { sourceType_sourceId: { sourceType: "JOIN_APPLICATION", sourceId: receipt.id } },
  });
  assert.equal(reviewed.provisionStatus, "SUCCEEDED");
  assert.ok(reviewed.initializationSecret);
  const login = await authService.login(
    { qq: input.qq, password: reviewed.initializationSecret! },
    { requestId: "req_auth_login", ipAddress: "127.0.0.21" },
  );
  assert.equal(login.mustChangePassword, true);
  await assert.rejects(
    () =>
      authenticateRequest(
        new Request("http://localhost/member", {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${login.token}` },
        }),
        "req_forced_password",
      ),
    (error) => error instanceof AppError && error.code === "PASSWORD_CHANGE_REQUIRED",
  );
  const otherLogin = await authService.login(
    { qq: input.qq, password: reviewed.initializationSecret! },
    { requestId: "req_auth_login_other", ipAddress: "127.0.0.22" },
  );
  const changed = await authService.changePassword(
    login.token,
    {
      currentPassword: reviewed.initializationSecret!,
      newPassword: "Changed-Password-2026",
      newPasswordConfirmation: "Changed-Password-2026",
    },
    { requestId: "req_auth_change", ipAddress: "127.0.0.21" },
  );
  assert.equal(changed.mustChangePassword, false);
  await assert.rejects(
    () => authService.authenticate(login.token),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_INVALID",
  );
  await assert.rejects(
    () => authService.authenticate(otherLogin.token),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_INVALID",
  );
  assert.equal((await authService.authenticate(changed.token)).userId, provision.userId);
  const result = await (
    await import("../../src/features/accounts/account-provision-service")
  ).accountProvisionService.provisionFromApplication(receipt.id, provision.idempotencyKey);
  assert.equal(result.initializationSecret, undefined, "幂等重放不得再次泄露初始密码");
  const credential = await getDb().passwordCredential.findUniqueOrThrow({
    where: { userId: provision.userId! },
  });
  assert.equal(credential.mustChangePassword, false);
  const identity = await getDb().userIdentity.findUniqueOrThrow({
    where: { type_identifierNormalized: { type: "QQ", identifierNormalized: input.qq } },
  });
  assert.equal(identity.userId, provision.userId);
});

dbTest("邀请码注册使用自设密码且不要求首次改密", async () => {
  const created = await inviteCodeService.create({ maxUses: 1 }, adminActor);
  const qq = `5${String(Date.now()).slice(-9)}`;
  const password = "Invite-Password-2026";
  const registration = await inviteCodeService.redeem(
    {
      code: created.plainCode,
      idempotencyKey: randomUUID(),
      realName: "邀请成员",
      qq,
      phone: `135${String(Date.now()).slice(-8)}`,
      password,
    },
    { requestId: "req_invite_auth" },
  );
  const login = await authService.login(
    { qq, password },
    { requestId: "req_invite_login", ipAddress: "127.0.0.31" },
  );
  assert.equal(login.userId, registration.userId);
  assert.equal(login.mustChangePassword, false);
  const stored = await getDb().authSession.findUniqueOrThrow({ where: { id: login.sessionId } });
  assert.notEqual(
    Buffer.from(stored.tokenDigest).toString("hex"),
    Buffer.from(login.token).toString("hex"),
  );
  const expiring = await authService.login(
    { qq, password },
    { requestId: "req_invite_expiring", ipAddress: "127.0.0.32" },
  );
  await getDb().authSession.update({
    where: { id: expiring.sessionId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  await assert.rejects(
    () => authService.authenticate(expiring.token),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_EXPIRED",
  );
  await authService.logout(login.token, { requestId: "req_invite_logout" });
  await assert.rejects(
    () => authService.authenticate(login.token),
    (error) => error instanceof AppError && error.code === "AUTH_SESSION_INVALID",
  );
  assert.ok(
    await getDb().auditLog.findFirst({
      where: { action: "auth.session.revoked", targetId: login.sessionId },
    }),
  );
});

dbTest("错误密码触发数据库共享限流且不区分不存在账号", async () => {
  const qq = `4${String(Date.now()).slice(-9)}`;
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, (_, attempt) =>
      authService.login(
        { qq, password: "Wrong-Password-2026" },
        { requestId: `req_bad_${attempt}`, ipAddress: "127.0.0.41" },
      ),
    ),
  );
  assert.equal(
    attempts.every((result) => result.status === "rejected"),
    true,
  );
  assert.equal(
    attempts.every(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof AppError &&
        result.reason.code === "AUTH_INVALID_CREDENTIALS",
    ),
    true,
  );
  await assert.rejects(
    () =>
      authService.login(
        { qq, password: "Wrong-Password-2026" },
        { requestId: "req_blocked", ipAddress: "127.0.0.41" },
      ),
    (error) => error instanceof AppError && error.code === "AUTH_RATE_LIMITED",
  );
  assert.equal(await getDb().loginThrottle.count(), 1);
});

dbTest("管理员直建成员幂等且只在首次返回初始密码", async () => {
  const idempotencyKey = randomUUID();
  const input = {
    realName: "直建成员",
    qq: `3${String(Date.now()).slice(-9)}`,
    phone: `134${String(Date.now()).slice(-8)}`,
    idempotencyKey,
  };
  const first = await memberService.create(input, adminActor);
  const replay = await memberService.create(input, adminActor);
  assert.ok(first.initializationSecret);
  assert.equal(replay.initializationSecret, undefined);
  assert.equal(replay.member.id, first.member.id);
});

dbTest("成员身份撤销后已有 Session 实时失效", async () => {
  const created = await memberService.create(
    {
      realName: "待停用成员",
      qq: `2${String(Date.now()).slice(-9)}`,
      phone: `133${String(Date.now()).slice(-8)}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
  const identity = await getDb().userIdentity.findFirstOrThrow({
    where: { userId: created.member.userId, type: "QQ" },
  });
  const login = await authService.login(
    { qq: identity.identifierNormalized, password: created.initializationSecret! },
    { requestId: "req_disable_login", ipAddress: "127.0.0.51" },
  );
  await memberService.setEnabled(created.member.id, false, adminActor);
  await assert.rejects(
    () => authService.authenticate(login.token),
    (error) =>
      error instanceof AppError &&
      (error.code === "AUTH_SESSION_INVALID" || error.code === "MEMBER_PROFILE_INACTIVE"),
  );
});

dbTest("普通成员不能调用管理员成员 Service", async () => {
  await assert.rejects(
    () =>
      memberService.create(
        {
          realName: "越权成员",
          qq: "223456789",
          phone: "13200000000",
          idempotencyKey: randomUUID(),
        },
        {
          actorType: "USER",
          userId: "20000000-0000-4000-8000-000000000099",
          userStatus: "ACTIVE",
          permissions: permissionsForRoles(["MEMBER"]),
          requestId: "req_member_forbidden",
        },
      ),
    (error) => error instanceof AppError && error.code === "FORBIDDEN",
  );
});

dbTest("M2 草稿、照片、提交、审核、可见性与统计形成闭环", async () => {
  const first = await memberService.create(
    {
      realName: "维修成员甲",
      qq: `6${String(Date.now()).slice(-9)}`,
      phone: `131${String(Date.now()).slice(-8)}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
  const second = await memberService.create(
    {
      realName: "维修成员乙",
      qq: `7${String(Date.now() + 1).slice(-9)}`,
      phone: `130${String(Date.now() + 1).slice(-8)}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
  const actor = (userId: string, requestId: string) => ({
    actorType: "USER" as const,
    userId,
    userStatus: "ACTIVE" as const,
    permissions: permissionsForRoles(["MEMBER"]),
    requestId,
  });
  const owner = actor(first.member.userId, "req_m2_owner");
  const other = actor(second.member.userId, "req_m2_other");
  const key = randomUUID();
  const draft = await repairService.createDraft({ idempotencyKey: key }, owner);
  assert.equal((await repairService.createDraft({ idempotencyKey: key }, owner)).id, draft.id);
  const category = await getDb().repairCategory.findUniqueOrThrow({ where: { code: "M2_TEST" } });
  const updated = await repairService.update(
    draft.id,
    {
      version: draft.version,
      repairDate: new Date().toISOString().slice(0, 10),
      durationMinutes: 90,
      categoryId: category.id,
      content: "完成故障检查、清理并复测，设备恢复正常。",
      result: "COMPLETED",
      remark: "集成测试记录",
    },
    owner,
  );
  await assert.rejects(
    () =>
      repairService.update(
        draft.id,
        { version: draft.version, content: "过期版本不应覆盖" },
        owner,
      ),
    (error) => error instanceof AppError && error.code === "REPAIR_VERSION_CONFLICT",
  );
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const uploaded = await repairPhotoService.upload(
    draft.id,
    [new File([png], "../../unsafe.png", { type: "image/png" })],
    owner,
  );
  const submitted = await repairService.submit(
    draft.id,
    { version: updated.version, idempotencyKey: randomUUID() },
    owner,
  );
  assert.equal(submitted.status, "PENDING");
  await assert.rejects(
    () => repairQueryService.getById(draft.id, other),
    (error) => error instanceof AppError && error.code === "REPAIR_NOT_FOUND",
  );
  await assert.rejects(
    () => repairPhotoService.open(uploaded[0]!.id, other),
    (error) => error instanceof AppError && error.code === "REPAIR_NOT_FOUND",
  );
  const approved = await repairReviewService.review(
    draft.id,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    adminActor,
  );
  assert.equal(approved.status, "APPROVED");
  assert.equal((await repairQueryService.getById(draft.id, other)).id, draft.id);
  assert.equal(
    (await listApprovedRepairsForAnalytics()).some((row) => row.id === draft.id),
    true,
  );
  await repairService.softDelete(draft.id, "集成测试软删除", adminActor);
  assert.equal(
    (await listApprovedRepairsForAnalytics()).some((row) => row.id === draft.id),
    false,
  );
});

dbTest("M2 数据库写入失败会补偿删除已写入的文件", async () => {
  const created = await memberService.create(
    {
      realName: "存储补偿成员",
      qq: `9${String(Date.now()).slice(-9)}`,
      phone: `132${String(Date.now()).slice(-8)}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
  const owner = {
    actorType: "USER" as const,
    userId: created.member.userId,
    userStatus: "ACTIVE" as const,
    permissions: permissionsForRoles(["MEMBER"]),
    requestId: "req_m2_compensation",
  };
  const draft = await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);
  const deleted: string[] = [];
  const service = createRepairPhotoService({
    async put() {
      return { storageKey: "repairs/fixed-duplicate.png" };
    },
    async open() {
      return new Uint8Array();
    },
    async delete(key) {
      deleted.push(key);
    },
  });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await assert.rejects(
    () =>
      service.upload(
        draft.id,
        [
          new File([png], "a.png", { type: "image/png" }),
          new File([png], "b.png", { type: "image/png" }),
        ],
        owner,
      ),
    (error) => error instanceof AppError && error.code === "REPAIR_PHOTO_STORAGE_FAILED",
  );
  assert.equal(await getDb().repairPhoto.count({ where: { repairRecordId: draft.id } }), 0);
  assert.equal(deleted.length, 2);
});

dbTest("M2 并发审核只有一个结果成功且事务记录一致", async () => {
  const created = await memberService.create(
    {
      realName: "并发审核成员",
      qq: `8${String(Date.now()).slice(-9)}`,
      phone: `139${String(Date.now()).slice(-8)}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
  const owner = {
    actorType: "USER" as const,
    userId: created.member.userId,
    userStatus: "ACTIVE" as const,
    permissions: permissionsForRoles(["MEMBER"]),
    requestId: "req_m2_concurrent_owner",
  };
  const category = await getDb().repairCategory.findUniqueOrThrow({ where: { code: "M2_TEST" } });
  const draft = await repairService.createDraft(
    {
      idempotencyKey: randomUUID(),
      repairDate: new Date().toISOString().slice(0, 10),
      durationMinutes: 30,
      categoryId: category.id,
      content: "并发审核测试维修内容已满足最小长度。",
      result: "NOT_COMPLETED",
    },
    owner,
  );
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0]);
  await repairPhotoService.upload(
    draft.id,
    [new File([jpeg], "case.jpg", { type: "image/jpeg" })],
    owner,
  );
  const pending = await repairService.submit(
    draft.id,
    { version: draft.version, idempotencyKey: randomUUID() },
    owner,
  );
  assert.equal(pending.status, "PENDING");
  const settled = await Promise.allSettled([
    repairReviewService.review(
      draft.id,
      { decision: "APPROVED", idempotencyKey: randomUUID() },
      adminActor,
    ),
    repairReviewService.review(
      draft.id,
      { decision: "REJECTED", note: "资料需要补充", idempotencyKey: randomUUID() },
      { ...adminActor, requestId: "req_m2_review_2" },
    ),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await getDb().repairReview.count({ where: { repairRecordId: draft.id } }), 1);
  assert.equal(
    await getDb().auditLog.count({
      where: { targetId: draft.id, action: { in: ["repair.approved", "repair.rejected"] } },
    }),
    1,
  );
});
