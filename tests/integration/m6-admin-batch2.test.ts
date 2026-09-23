import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import {
  PUBLIC_CONTENT_SETTINGS_DEFAULTS,
  PUBLIC_CONTENT_SETTINGS_ID,
  publicContentSettingsService,
} from "../../src/features/admin/public-content-settings-service";
import { auditLogService } from "../../src/features/admin/audit-log-service";
import { joinApplicationExportService } from "../../src/features/admin/join-application-export-service";
import { repairCommentService } from "../../src/features/community/comment-service";
import { commentAdminService } from "../../src/features/community/comment-admin-service";
import { inviteCodeService } from "../../src/features/invitations/invite-code-service";
import { memberService } from "../../src/features/members/member-service";
import { joinApplicationService } from "../../src/features/recruitment/join-application-service";
import { repairCategoryService } from "../../src/features/repairs/repair-category-service";
import { repairService } from "../../src/features/repairs/repair-service";
import { skillAdminService } from "../../src/features/skills/skill-admin-service";
import { AppError, type ApiErrorCode } from "../../src/lib/api/errors";
import { authService } from "../../src/features/auth/auth-service";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";

const enabled = process.env.RUN_DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db";
const dbTest = enabled ? test : test.skip;

/**
 * M6 批次 2 集成测试（真实 GreatSQL）。
 *
 * 独立 UUID 段 `e7000000-…`、realName 前缀 `"M6-B "`、技能 code 前缀 `M6B_`：
 * 清理一律按这三者限定，**绝不触碰库里已有的真实开发数据**
 * （例如开发者自己 bootstrap 的管理员与它写下的审计记录）。
 *
 * 与 `m6-admin.test.ts` 的前缀刻意区分：那边的清理条件是 `realName startsWith "M6 "`，
 * 含空格，不会命中这里的 `"M6-B …"`。
 */
const ADMIN_USER_ID = "e7000000-0000-4000-8000-000000000001";
const ADMIN_PROFILE_ID = "e7000000-0000-4000-8000-000000000002";
const CATEGORY_ID = "e7000000-0000-4000-8000-000000000003";
const CATEGORY_CODE = "M6B_TEST";

const ADMIN_ACTOR: AuthorizedActor = {
  actorType: "USER",
  userId: ADMIN_USER_ID,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m6b_integration_admin",
};

function memberActor(userId: string): AuthorizedActor {
  return {
    actorType: "USER",
    userId,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["MEMBER"]),
    requestId: "req_m6b_integration_member",
  };
}

/** 备份：公开统计设置是**全局单行**，测试必须原样还回去（连值一起）。 */
let settingsBackup: Awaited<ReturnType<typeof readSettingsRow>> = null;

async function readSettingsRow() {
  return getDb().publicContentSetting.findUnique({ where: { id: PUBLIC_CONTENT_SETTINGS_ID } });
}

async function testUserIds(): Promise<string[]> {
  const profiles = await getDb().memberProfile.findMany({
    where: { realName: { startsWith: "M6-B " } },
    select: { userId: true },
  });
  return [...new Set([ADMIN_USER_ID, ...profiles.map((row) => row.userId)])];
}

async function prepareFixtures(): Promise<void> {
  const db = getDb();
  const userIds = await testUserIds();
  const profiles = await db.memberProfile.findMany({
    where: { OR: [{ realName: { startsWith: "M6-B " } }, { id: ADMIN_PROFILE_ID }] },
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
      ],
    },
  });
  await db.repairComment.updateMany({
    where: { record: records },
    data: { parentCommentId: null },
  });
  await db.commentMention.deleteMany({ where: { comment: { record: records } } });
  await db.repairComment.deleteMany({ where: { record: records } });
  await db.repairTimelineEvent.deleteMany({ where: { record: records } });
  await db.repairReview.deleteMany({ where: { record: records } });
  await db.repairPhoto.deleteMany({ where: { record: records } });
  await db.repairRecord.deleteMany({ where: records });
  await db.userSkill.deleteMany({ where: { memberProfileId: { in: profileIds } } });
  await db.accountProvision.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { memberProfileId: { in: profileIds } }] },
  });
  await db.inviteCodeRedemption.deleteMany({ where: { userId: { in: userIds } } });
  // 只删本次测试创建者写下的邀请码（`displayPrefix` 无法反查，创建者可以）。
  await db.inviteCode.deleteMany({ where: { createdByUserId: ADMIN_USER_ID } });
  await db.joinApplicationReview.deleteMany({
    where: { application: { realName: { startsWith: "M6-B " } } },
  });
  await db.joinApplication.deleteMany({ where: { realName: { startsWith: "M6-B " } } });
  // 技能与分类的 `created_by` 也是指向 User 的 Restrict 外键，
  // 必须在 `user.deleteMany()` **之前**清掉，否则报
  // `Foreign key constraint violated on the fields: (created_by)`。
  // 按**创建者**清而不是按 code 前缀：标识现在由系统生成（中文名会得到 `SK_xxxx` 这类
  // 哈希），按前缀清会漏掉它们，然后卡在同一个外键错误上。
  await db.skill.deleteMany({
    where: { OR: [{ code: { startsWith: "M6B_" } }, { createdBy: { in: userIds } }] },
  });
  await db.repairCategory.deleteMany({
    where: { OR: [{ code: CATEGORY_CODE }, { createdBy: { in: userIds } }] },
  });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profileIds } } });
  // 公开统计设置是**全局单行**，不随测试清空重建；它记着「谁最后改的」，
  // 那个外键（Restrict）会挡住本测试账号的删除。只解引用本测试拥有的用户。
  await db.publicContentSetting.updateMany({
    where: { updatedByUserId: { in: userIds } },
    data: { updatedByUserId: null },
  });
  await db.user.deleteMany({ where: { id: { in: userIds } } });

  const now = new Date();
  await db.user.create({
    data: {
      id: ADMIN_USER_ID,
      status: "ACTIVE",
      displayName: "M6B Admin",
      createdAt: now,
      updatedAt: now,
    },
  });
  // 管理员**刻意不建成员档案**：批次 2 要打通的场景。
  await db.repairCategory.create({
    data: {
      id: CATEGORY_ID,
      code: CATEGORY_CODE,
      name: "M6B 测试分类",
      sortOrder: 1,
      createdAt: now,
    },
  });
}

before(async () => {
  if (!enabled) return;
  process.env.UPLOAD_PATH = `${process.env.UPLOAD_PATH ?? "./storage/uploads"}`;
  settingsBackup = await readSettingsRow();
  await prepareFixtures();
});
beforeEach(async () => {
  if (!enabled) return;
  await prepareFixtures();
});
after(async () => {
  if (!enabled) return;
  const db = getDb();
  // 单行配置表原样还原：测试可以通过它，但不能把开发环境的策略改掉。
  await db.publicContentSetting.deleteMany({ where: { id: PUBLIC_CONTENT_SETTINGS_ID } });
  if (settingsBackup) {
    // 逐字段回填而不展开整行：`updatedAt` 在 schema 里是 `@updatedAt`，由客户端托管，
    // 不能原样回填（展开会把用不到的 `updatedAt` 带进一个多余的变量）。
    await db.publicContentSetting.create({
      data: {
        id: settingsBackup.id,
        publicRepairStatsEnabled: settingsBackup.publicRepairStatsEnabled,
        publicRepairStatsDetailEnabled: settingsBackup.publicRepairStatsDetailEnabled,
        publicRankingsEnabled: settingsBackup.publicRankingsEnabled,
        rankingDisplayName: settingsBackup.rankingDisplayName,
        updatedByUserId: settingsBackup.updatedByUserId,
        createdAt: settingsBackup.createdAt,
        updatedAt: new Date(),
      },
    });
  }
  await disconnectDb();
});

/* --------------------------------------------------------------- 权限边界 */

dbTest("批次 2 的管理端 Service 对普通成员一律 FORBIDDEN", async () => {
  const owner = await createMember("权限");
  const member = owner.actor;
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["skill.list", () => skillAdminService.list(member)],
    ["skill.create", () => skillAdminService.create({ code: "M6B_X", name: "x" }, member)],
    ["skill.setActive", () => skillAdminService.setActive("any", false, member)],
    ["skill.move", () => skillAdminService.move("any", null, member)],
    ["member.move", () => memberService.move(["any"], null, member)],
    ["comment.list", () => commentAdminService.list({ page: 1, pageSize: 20 }, member)],
    ["comment.softDelete", () => commentAdminService.softDelete("any", member)],
    ["invite.list", () => inviteCodeService.list({ page: 1, pageSize: 20 }, member)],
    ["audit.list", () => auditLogService.list({ page: 1, pageSize: 20 }, member)],
    ["audit.listActions", () => auditLogService.listActions(member)],
    ["settings.get", () => publicContentSettingsService.get(member)],
    [
      "settings.update",
      () => publicContentSettingsService.update({ ...PUBLIC_CONTENT_SETTINGS_DEFAULTS }, member),
    ],
    ["application.export", () => joinApplicationExportService.export({}, "CSV", member)],
  ];
  for (const [label, run] of cases) {
    await assert.rejects(run, (error) => hasCode(error, "FORBIDDEN"), `${label} 未拒绝普通成员`);
  }
});

/* ------------------------------------------------------------------- 技能 */

dbTest("技能标签库：增改停用启用、重复 code、引用计数与审计", async () => {
  const created = await skillAdminService.create(
    { code: "m6b_network", name: "M6B 网络", description: "测试用", sortOrder: 3 },
    ADMIN_ACTOR,
  );
  // code 统一大写：小写输入不该产生第二个「同名不同大小写」的标签。
  assert.equal(created.code, "M6B_NETWORK");

  await assert.rejects(
    () => skillAdminService.create({ code: "M6B_NETWORK", name: "重复" }, ADMIN_ACTOR),
    (error) => hasCode(error, "SKILL_CODE_CONFLICT"),
  );

  const listed = await skillAdminService.list(ADMIN_ACTOR);
  const mine = listed.find((row) => row.id === created.id);
  assert.ok(mine, "管理端列表应包含新建的技能标签");
  assert.equal(mine.usedByMemberCount, 0);

  const updated = await skillAdminService.update(
    created.id,
    { name: "M6B 网络（已改）", description: null, sortOrder: 5 },
    ADMIN_ACTOR,
  );
  assert.equal(updated.name, "M6B 网络（已改）");
  assert.equal(updated.description, null);

  const off = await skillAdminService.setActive(created.id, false, ADMIN_ACTOR);
  assert.equal(off.isActive, false);
  // 停用后仍在管理端列表里，但成员侧 `/api/v1/skills` 不再返回它。
  assert.ok((await skillAdminService.list(ADMIN_ACTOR)).some((row) => row.id === created.id));
  assert.equal(await isMemberVisible(created.id), false);

  const on = await skillAdminService.setActive(created.id, true, ADMIN_ACTOR);
  assert.equal(on.isActive, true);
  assert.equal(await isMemberVisible(created.id), true);

  await assert.rejects(
    () => skillAdminService.setActive("e7000000-0000-4000-8000-00000000dead", false, ADMIN_ACTOR),
    (error) => hasCode(error, "SKILL_NOT_FOUND"),
  );

  const actions = await auditLogService.listActions(ADMIN_ACTOR);
  for (const action of ["skill.created", "skill.updated", "skill.deactivated", "skill.activated"]) {
    assert.ok(
      actions.some((row) => row.action === action),
      `缺少审计动作 ${action}`,
    );
  }
});

dbTest("技能标签：不填标识也能建、重复名称报冲突、上移下移改顺序", async () => {
  // 1) 不传 code：服务端按名称生成（含中文时是名称哈希），管理员不需要编英文标识
  const created = await skillAdminService.create({ name: "散热清灰" }, ADMIN_ACTOR);
  assert.match(created.code, /^SK_[0-9A-F]{8}$/);

  // 2) 同名再建一次 → 冲突，且报的是**名称**（管理员填的是名称）
  await assert.rejects(
    () => skillAdminService.create({ name: "散热清灰" }, ADMIN_ACTOR),
    (error) => hasCode(error, "SKILL_CODE_CONFLICT"),
  );

  // 3) 纯 ASCII 名称走折叠slug分支
  const ascii = await skillAdminService.create({ name: "GPU Repair" }, ADMIN_ACTOR);
  assert.equal(ascii.code, "GPU_REPAIR");

  // 4) 新建项排在末尾；上移一格后与它前面的项交换
  const before = await skillAdminService.list(ADMIN_ACTOR);
  const last = before.at(-1)!;
  const previous = before.at(-2)!;
  assert.equal(last.id, ascii.id, "新标签应追加到末尾");

  await skillAdminService.reorder(ascii.id, "UP", ADMIN_ACTOR);
  const after = await skillAdminService.list(ADMIN_ACTOR);
  assert.deepEqual(
    after.slice(-2).map((row) => row.id),
    [ascii.id, previous.id],
  );

  // 5) 首项再上移：幂等成功，不报错（用户点了一个不会改变任何东西的按钮）
  await skillAdminService.reorder(after[0].id, "UP", ADMIN_ACTOR);
  assert.deepEqual(
    (await skillAdminService.list(ADMIN_ACTOR)).map((row) => row.id),
    after.map((row) => row.id),
  );

  // 6) 未知 id → 404；审计留下调整记录
  await assert.rejects(
    () => skillAdminService.reorder("e7000000-0000-4000-8000-0000000000ff", "UP", ADMIN_ACTOR),
    (error) => hasCode(error, "SKILL_NOT_FOUND"),
  );
  const audit = await auditLogService.list(
    { page: 1, pageSize: 20, action: "skill.reordered" },
    ADMIN_ACTOR,
  );
  assert.equal(audit.items.length, 1);
});

dbTest("技能标签：拖动排序一次跨越任意格，落点与原位相同则幂等", async () => {
  const rows = await skillAdminService.list(ADMIN_ACTOR);
  assert.ok(rows.length >= 3, "拖动排序需要至少 3 个标签才能验证跨越");
  const [first, , third] = rows;

  // 把第一项拖到第三项之前（一次跨两格），结果必须是「第三项的位置之前刚好是第一项」
  await skillAdminService.move(first.id, third.id, ADMIN_ACTOR);
  const moved = await skillAdminService.list(ADMIN_ACTOR);
  const positions = moved.map((row) => row.id);
  assert.equal(
    positions.indexOf(first.id),
    positions.indexOf(third.id) - 1,
    "拖动后目标项应当紧跟在落点项之前",
  );
  // 序号必须是稠密的 0..n-1：拖动排序与上移 / 下移写的是同一套序号
  assert.deepEqual(
    moved.map((row) => row.sortOrder),
    moved.map((_, index) => index),
  );

  // 拖到末尾：`beforeId` 为 null
  await skillAdminService.move(first.id, null, ADMIN_ACTOR);
  assert.equal((await skillAdminService.list(ADMIN_ACTOR)).at(-1)!.id, first.id);

  // 落点与原位相同 → 幂等成功，且不写审计（拖动经过同一格松手不该留痕）
  const beforeIdempotent = await skillAdminService.list(ADMIN_ACTOR);
  const auditBefore = await auditLogService.list(
    { page: 1, pageSize: 50, action: "skill.moved" },
    ADMIN_ACTOR,
  );
  await skillAdminService.move(first.id, null, ADMIN_ACTOR);
  assert.deepEqual(
    (await skillAdminService.list(ADMIN_ACTOR)).map((row) => row.id),
    beforeIdempotent.map((row) => row.id),
  );
  const auditAfter = await auditLogService.list(
    { page: 1, pageSize: 50, action: "skill.moved" },
    ADMIN_ACTOR,
  );
  assert.equal(auditAfter.items.length, auditBefore.items.length, "幂等拖动不应新增审计");

  // 未知 id → 404（与上移 / 下移同一个错误码）
  await assert.rejects(
    () => skillAdminService.move("e7000000-0000-4000-8000-0000000000ff", null, ADMIN_ACTOR),
    (error) => hasCode(error, "SKILL_NOT_FOUND"),
  );
});

dbTest("故障分类：拖动排序与技能标签同一实现", async () => {
  const rows = await repairCategoryService.listAll(ADMIN_ACTOR);
  assert.ok(rows.length >= 2, "拖动排序需要至少 2 个分类");
  const [first, second] = rows;

  await repairCategoryService.move(second.id, first.id, ADMIN_ACTOR);
  const moved = await repairCategoryService.listAll(ADMIN_ACTOR);
  assert.equal(moved[0].id, second.id, "拖动后第二项应当排到第一位");
  assert.deepEqual(
    moved.map((row) => row.sortOrder),
    moved.map((_, index) => index),
  );

  await assert.rejects(
    () => repairCategoryService.move("e7000000-0000-4000-8000-0000000000fe", null, ADMIN_ACTOR),
    (error) => hasCode(error, "RESOURCE_NOT_FOUND"),
  );
});

dbTest("成员列表：拖动排序写库、序号稠密、落点没变则幂等且不留审计", async () => {
  /* 成员顺序是**全局**的（列表、筛选、分页都用同一份顺序），所以这里断言的是
     「相对位置」与「整份序号稠密」，不去假设测试库里到底有多少人。 */
  const [a, b, c] = [
    await createMember("顺序甲"),
    await createMember("顺序乙"),
    await createMember("顺序丙"),
  ];
  const order = async () => {
    const page = await memberService.list({ page: 1, pageSize: 200 }, ADMIN_ACTOR);
    return page.items.map((row) => row.id);
  };

  // 1) 拖到落点项之前（可能跨越好几行）
  await memberService.move([a.member.id], b.member.id, ADMIN_ACTOR);
  const afterFirst = await order();
  assert.equal(
    afterFirst.indexOf(a.member.id),
    afterFirst.indexOf(b.member.id) - 1,
    "拖动后应当紧跟在落点成员之前",
  );

  // 2) 序号必须稠密（0..n-1）：新建成员默认 sortOrder 是 0，与已有行重复，
  //    只交换两行序号的话下一次拖动就会「看起来没反应」。
  const dense = await getDb().memberProfile.findMany({
    where: { deletedAt: null },
    select: { sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  assert.deepEqual(
    dense.map((row) => row.sortOrder),
    dense.map((_, index) => index),
    "拖动排序必须把整份序号写成 0..n-1",
  );

  // 3) 拖到末尾：`beforeId` 为 null
  await memberService.move([a.member.id], null, ADMIN_ACTOR);
  assert.equal((await order()).at(-1), a.member.id, "beforeId 为 null 表示拖到末尾");

  // 4) 落点与原位相同 → 幂等成功，且不写审计（拖着经过同一格松手不该留痕）
  const auditBefore = await auditLogService.list(
    { page: 1, pageSize: 50, action: "member.moved" },
    ADMIN_ACTOR,
  );
  const beforeIdempotent = await order();
  await memberService.move([a.member.id], null, ADMIN_ACTOR);
  assert.deepEqual(await order(), beforeIdempotent, "幂等拖动不该改变顺序");
  const auditAfter = await auditLogService.list(
    { page: 1, pageSize: 50, action: "member.moved" },
    ADMIN_ACTOR,
  );
  assert.equal(auditAfter.items.length, auditBefore.items.length, "幂等拖动不应新增审计");

  // 5) 再从末尾往回拖，落在另一位成员之前
  await memberService.move([a.member.id], c.member.id, ADMIN_ACTOR);
  const afterThird = await order();
  assert.equal(
    afterThird.indexOf(a.member.id),
    afterThird.indexOf(c.member.id) - 1,
    "从末尾往回拖也要精确落在落点成员之前",
  );

  // 5b) 勾选多行后一起拖：整块移动，块内先后不变（第九轮）
  const before = await order();
  const blockIds = before.slice(2, 5); // 取连续三行当选中集合
  const anchorId = before[7];
  await memberService.move(blockIds, anchorId, ADMIN_ACTOR);
  const afterBlock = await order();
  assert.deepEqual(
    afterBlock.slice(afterBlock.indexOf(anchorId) - 3, afterBlock.indexOf(anchorId)),
    blockIds,
    "三行应当按原有先后整体插到落点之前",
  );
  // 同一落点再来一次：幂等，不写审计
  const auditBeforeBlock = await auditLogService.list(
    { page: 1, pageSize: 50, action: "member.moved" },
    ADMIN_ACTOR,
  );
  const movedAgain = await memberService.move(blockIds, anchorId, ADMIN_ACTOR);
  assert.equal(movedAgain, false, "落点没变时应返回 false（界面据此不提示）");
  assert.deepEqual(await order(), afterBlock, "幂等拖动不该改变顺序");
  assert.equal(
    (await auditLogService.list({ page: 1, pageSize: 50, action: "member.moved" }, ADMIN_ACTOR))
      .items.length,
    auditBeforeBlock.items.length,
    "幂等拖动不应新增审计",
  );

  // 6) 落点 id 不在列表里 / 被拖的成员不存在 → 404（与技能 / 分类同一个错误码）
  await assert.rejects(
    () => memberService.move([a.member.id], "e7000000-0000-4000-8000-0000000000fd", ADMIN_ACTOR),
    (error) => hasCode(error, "RESOURCE_NOT_FOUND"),
  );
  await assert.rejects(
    () => memberService.move(["e7000000-0000-4000-8000-0000000000fc"], null, ADMIN_ACTOR),
    (error) => hasCode(error, "RESOURCE_NOT_FOUND"),
  );
});

dbTest("密码长度边界：6 位可以通过，5 位被拒（策略前后端同一份）", async () => {
  /* 第十一轮：策略数字从 12 位下调到 6 位，且收敛到 `lib/security/password-policy.ts`。
     这里验证**服务端**那一侧真的跟着变了 —— 只改前端会出现「表单放行、后端报错」。 */
  const code = await inviteCodeService.create({ maxUses: 1, boundQq: "812345699" }, ADMIN_ACTOR);

  await assert.rejects(
    () =>
      inviteCodeService.redeem(
        {
          code: code.plainCode,
          idempotencyKey: randomUUID(),
          realName: "M6-B 短口令",
          qq: "812345699",
          phone: "13900000699",
          password: "12345",
        },
        { requestId: "req_m6b_short_password" },
      ),
    (error) => hasCode(error, "VALIDATION_FAILED"),
    "5 位口令应当被服务端拒绝",
  );

  const accepted = await inviteCodeService.redeem(
    {
      code: code.plainCode,
      idempotencyKey: randomUUID(),
      realName: "M6-B 短口令",
      qq: "812345699",
      phone: "13900000699",
      password: "123456",
    },
    { requestId: "req_m6b_short_password_ok" },
  );
  assert.ok(accepted.memberProfileId.length > 0, "6 位口令应当兑换成功");

  // 6 位口令真的能登录（哈希与校验两侧都不再自带更严的下限）
  const login = await authService.login(
    { qq: "812345699", password: "123456" },
    { requestId: "req_m6b_short_password_login", ipAddress: "127.0.0.99" },
  );
  assert.ok(login.token.length > 0, "短口令账号应当能登录");
});

async function isMemberVisible(skillId: string): Promise<boolean> {
  const rows = await skillAdminService.list(ADMIN_ACTOR);
  const row = rows.find((item) => item.id === skillId);
  return row?.isActive ?? false;
}

/* ------------------------------------------------------------------- 评论 */

dbTest("评论管理：跨记录列表、软删除，且纯管理员不再被 MEMBER_REQUIRED 挡住", async () => {
  const owner = await createMember("评论");
  const record = await draftRepair(owner.actor);
  const comment = await repairCommentService.create(
    record.id,
    { body: "M6B 集成测试评论正文" },
    owner.actor,
  );

  const listed = await commentAdminService.list(
    { page: 1, pageSize: 20, query: "M6B 集成测试评论" },
    ADMIN_ACTOR,
  );
  assert.equal(listed.items.length, 1);
  const entry = listed.items[0];
  assert.equal(entry.id, comment.id);
  assert.equal(entry.record.id, record.id);
  assert.equal(entry.author.name, "M6-B 评论");
  // 所属记录的成员名也要能直接看到（需求 §37「查看评论所属维修记录」）。
  assert.equal(entry.record.memberName, "M6-B 评论");
  assert.equal(entry.deletedAt, null);

  // 回归：修复前 `repairCommentService.softDelete` 会先要求操作者有 ACTIVE 成员档案，
  // 纯管理员在这一步就被 MEMBER_REQUIRED 拒掉，管理端删除违规评论根本走不通。
  await repairCommentService.softDelete(record.id, comment.id, ADMIN_ACTOR);

  const deleted = await commentAdminService.list(
    { page: 1, pageSize: 20, query: "M6B 集成测试评论", deleted: "DELETED" },
    ADMIN_ACTOR,
  );
  assert.equal(deleted.items.length, 1);
  assert.ok(deleted.items[0].deletedAt);
  // 默认视角（只看未删除）必须看不到它。
  const active = await commentAdminService.list(
    { page: 1, pageSize: 20, query: "M6B 集成测试评论" },
    ADMIN_ACTOR,
  );
  assert.equal(active.items.length, 0);

  await assert.rejects(
    () => commentAdminService.softDelete(comment.id, ADMIN_ACTOR),
    (error) => hasCode(error, "COMMENT_NOT_FOUND"),
  );
});

/* --------------------------------------------------------------- 邀请码 */

dbTest("邀请码列表：分页、生效状态筛选（含派生的已用尽）", async () => {
  const now = Date.now();
  const active = await inviteCodeService.create({ maxUses: 5, boundQq: "812345678" }, ADMIN_ACTOR);
  const notStarted = await inviteCodeService.create(
    {
      maxUses: 5,
      activeFrom: new Date(now + 86_400_000).toISOString(),
      boundQq: "812345679",
    },
    ADMIN_ACTOR,
  );
  const expired = await inviteCodeService.create(
    {
      maxUses: 5,
      activeFrom: new Date(now - 172_800_000).toISOString(),
      expiresAt: new Date(now - 3_600_000).toISOString(),
      boundQq: "812345680",
    },
    ADMIN_ACTOR,
  );
  const exhausted = await inviteCodeService.create(
    { maxUses: 1, boundQq: "812345681" },
    ADMIN_ACTOR,
  );
  await inviteCodeService.redeem(
    {
      code: exhausted.plainCode,
      idempotencyKey: randomUUID(),
      realName: "M6-B 兑换",
      qq: "812345681",
      phone: "13900000681",
      password: "m6b-integration-password",
    },
    { requestId: "req_m6b_redeem" },
  );

  // 绑定 QQ 是**精确匹配**检索（与报名列表同一约定），因此每条码用各自的完整 QQ 定位，
  // 断言「该状态查得到它」+「其它状态查不到它」两件事。
  const find = async (status: Parameters<typeof inviteCodeService.list>[0]["status"], qq: string) =>
    (
      await inviteCodeService.list({ page: 1, pageSize: 50, status, query: qq }, ADMIN_ACTOR)
    ).items.map((row) => row.id);

  assert.deepEqual(await find("ACTIVE", "812345678"), [active.id]);
  assert.deepEqual(await find("NOT_STARTED", "812345679"), [notStarted.id]);
  assert.deepEqual(await find("EXPIRED", "812345680"), [expired.id]);
  assert.deepEqual(await find("EXHAUSTED", "812345681"), [exhausted.id]);
  // 跨状态必须是互斥的：未生效的码不属于 ACTIVE，用尽的码不属于 ACTIVE。
  assert.deepEqual(await find("ACTIVE", "812345679"), []);
  assert.deepEqual(await find("ACTIVE", "812345681"), []);
  assert.deepEqual(await find("EXPIRED", "812345678"), []);
  assert.deepEqual(await find("REVOKED", "812345678"), []);

  // 撤销后从 ACTIVE 移到 REVOKED。
  await inviteCodeService.revoke(active.id, ADMIN_ACTOR);
  assert.deepEqual(await find("ACTIVE", "812345678"), []);
  assert.deepEqual(await find("REVOKED", "812345678"), [active.id]);

  // 绑定信息脱敏。
  const revoked = (await find("REVOKED", "812345678")).length === 1;
  assert.ok(revoked);
  const listed = (
    await inviteCodeService.list({ page: 1, pageSize: 50, query: "812345678" }, ADMIN_ACTOR)
  ).items[0];
  assert.equal(listed.boundQqMasked, "81*****78");
  assert.ok(listed.createdAt);
  assert.ok(listed.revokedAt);

  // 分页元数据：不依赖「库里只有本测试的码」这个前提。
  const page = await inviteCodeService.list({ page: 1, pageSize: 2 }, ADMIN_ACTOR);
  assert.equal(page.items.length, 2);
  assert.ok(page.pagination.total >= 4);
  assert.equal(page.pagination.page, 1);
  assert.equal(page.pagination.pageSize, 2);
  assert.equal(page.pagination.totalPages, Math.ceil(page.pagination.total / 2));
});

/* ------------------------------------------------------------------- 审计 */

dbTest("审计查询：按动作筛选、动作清单、日期边界按上海自然日", async () => {
  await skillAdminService.create({ code: "M6B_AUDIT", name: "M6B 审计" }, ADMIN_ACTOR);

  const byAction = await auditLogService.list(
    { page: 1, pageSize: 20, action: "skill.created" },
    ADMIN_ACTOR,
  );
  assert.ok(byAction.items.length >= 1);
  assert.ok(byAction.items.every((row) => row.action === "skill.created"));
  assert.ok(byAction.items.every((row) => row.result === "SUCCESS"));
  const mine = byAction.items.find((row) => row.actorUserId === ADMIN_USER_ID);
  assert.ok(mine);
  // 没有成员档案的管理员回退到账号展示名，而不是空字符串。
  assert.equal(mine.actorName, "M6B Admin");

  const options = await auditLogService.listActions(ADMIN_ACTOR);
  assert.ok(options.every((row) => row.count > 0));
  assert.deepEqual(
    options.map((row) => row.count),
    [...options.map((row) => row.count)].sort((a, b) => b - a),
  );

  // 今天（上海自然日）必须能查到刚写下的记录：结束日包含全天。
  const today = shanghaiToday();
  const inRange = await auditLogService.list(
    { page: 1, pageSize: 20, action: "skill.created", createdFrom: today, createdTo: today },
    ADMIN_ACTOR,
  );
  assert.ok(inRange.items.length >= 1, "同一天起止必须命中当天记录");

  const before = shanghaiToday(-1);
  const noneInRange = await auditLogService.list(
    { page: 1, pageSize: 20, action: "skill.created", createdFrom: before, createdTo: before },
    ADMIN_ACTOR,
  );
  assert.equal(noneInRange.items.length, 0);

  await assert.rejects(
    () =>
      auditLogService.list(
        { page: 1, pageSize: 20, createdFrom: "2026-09-22", createdTo: "2026-09-21" },
        ADMIN_ACTOR,
      ),
    (error) => hasCode(error, "VALIDATION_FAILED"),
  );
});

function shanghaiToday(offsetDays = 0): string {
  return new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------- 公开设置 */

dbTest("公开统计设置：默认全关、单行 upsert、辅助数据跟随主开关、审计", async () => {
  await getDb().publicContentSetting.deleteMany({ where: { id: PUBLIC_CONTENT_SETTINGS_ID } });
  const initial = await publicContentSettingsService.get(ADMIN_ACTOR);
  assert.deepEqual(
    {
      publicRepairStatsEnabled: initial.publicRepairStatsEnabled,
      publicRepairStatsDetailEnabled: initial.publicRepairStatsDetailEnabled,
      publicRankingsEnabled: initial.publicRankingsEnabled,
      rankingDisplayName: initial.rankingDisplayName,
    },
    PUBLIC_CONTENT_SETTINGS_DEFAULTS,
  );
  assert.equal(initial.updatedAt, null);
  assert.equal(initial.updatedBy, null);

  const saved = await publicContentSettingsService.update(
    {
      publicRepairStatsEnabled: true,
      publicRepairStatsDetailEnabled: true,
      publicRankingsEnabled: true,
      rankingDisplayName: "REAL_NAME",
    },
    ADMIN_ACTOR,
  );
  assert.equal(saved.publicRepairStatsDetailEnabled, true);
  assert.equal(saved.rankingDisplayName, "REAL_NAME");
  assert.ok(saved.updatedAt);
  assert.equal(saved.updatedBy?.userId, ADMIN_USER_ID);
  assert.equal(saved.updatedBy?.name, "M6B Admin");

  // 关掉主开关时辅助数据必须一起归零，而不是留下一个「开着但不会生效」的项。
  const off = await publicContentSettingsService.update(
    {
      publicRepairStatsEnabled: false,
      publicRepairStatsDetailEnabled: true,
      publicRankingsEnabled: false,
      rankingDisplayName: "HIDDEN",
    },
    ADMIN_ACTOR,
  );
  assert.equal(off.publicRepairStatsDetailEnabled, false);

  // 单行约束：反复写入不会长出第二行。
  assert.equal(await getDb().publicContentSetting.count(), 1);

  await assert.rejects(
    () =>
      publicContentSettingsService.update(
        {
          publicRepairStatsEnabled: true,
          publicRepairStatsDetailEnabled: false,
          publicRankingsEnabled: false,
          rankingDisplayName: "QQ" as never,
        },
        ADMIN_ACTOR,
      ),
    (error) => hasCode(error, "PUBLIC_SETTINGS_INVALID"),
  );

  const audit = await auditLogService.list(
    { page: 1, pageSize: 20, action: "settings.public_content.updated" },
    ADMIN_ACTOR,
  );
  assert.ok(audit.items.length >= 2);
});

/* --------------------------------------------------------------- 报名导出 */

dbTest("报名导出：CSV 内容与审计，筛选与列表同源", async () => {
  const application = await joinApplicationService.submit(
    {
      recruitmentCycle: "M6B-2026",
      realName: "M6-B 报名者",
      qq: "812345690",
      phone: "13900000690",
      selfIntroduction: "M6B 集成测试自我介绍",
      preferredDirection: "硬件",
      privacyConsent: true,
    },
    { requestId: "req_m6b_join" },
  );

  const result = await joinApplicationExportService.export(
    { query: application.ticketNo },
    "CSV",
    ADMIN_ACTOR,
  );
  assert.equal(result.rowCount, 1);
  // BOM 的权威断言看字节：`new TextDecoder()` 默认会把 BOM 吃掉。
  assert.deepEqual([...result.body.slice(0, 3)], [0xef, 0xbb, 0xbf], "CSV 必须带 UTF-8 BOM");
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.body);
  assert.ok(text.includes("报名编号"));
  assert.ok(text.includes(application.ticketNo));
  assert.ok(text.includes("M6-B 报名者"));
  // 报名导出**故意**带明文联系方式（需求 §4.4），与维修导出的口径不同。
  assert.ok(text.includes("812345690"));
  assert.ok(text.includes("13900000690"));

  const xlsx = await joinApplicationExportService.export(
    { query: application.ticketNo },
    "XLSX",
    ADMIN_ACTOR,
  );
  // `.xlsx` 是 ZIP，前两字节固定为 PK。
  assert.equal(xlsx.body[0], 0x50);
  assert.equal(xlsx.body[1], 0x4b);

  const audit = await auditLogService.list(
    { page: 1, pageSize: 20, action: "join.applications.exported" },
    ADMIN_ACTOR,
  );
  // 两次导出都要留痕，且与维修导出分开检索。
  assert.equal(audit.items.length, 2);

  const none = await joinApplicationExportService.export(
    { query: "M6B-NOT-EXIST" },
    "CSV",
    ADMIN_ACTOR,
  );
  assert.equal(none.rowCount, 0);
});

/* ------------------------------------------------------------------ 夹具 */

let seq = 0;

async function createMember(label: string) {
  // 同一毫秒内连续建号会撞上 QQ / 手机号唯一键，因此用 `Date.now()` 尾部加自增序号。
  seq += 1;
  const serial = `${Date.now()}`.slice(-5) + String(seq).padStart(3, "0");
  const result = await memberService.create(
    {
      realName: `M6-B ${label}`,
      qq: `8${serial}`.slice(0, 11),
      phone: `139${serial}`.slice(0, 11),
      idempotencyKey: randomUUID(),
    },
    ADMIN_ACTOR,
  );
  return { ...result, actor: memberActor(result.member.userId) };
}

/**
 * 建一条**草稿**维修记录。
 *
 * 刻意不提交：M2 要求提交时至少一张照片，而评论可见性对记录主人不看状态
 * （`assertCanReadRepair` 先判归属），所以草稿足够覆盖评论管理，还省掉一整套上传夹具。
 */
async function draftRepair(owner: AuthorizedActor) {
  const draft = await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);
  return repairService.update(
    draft.id,
    {
      version: draft.version,
      repairDate: new Date().toISOString().slice(0, 10),
      durationMinutes: 30,
      categoryId: CATEGORY_ID,
      content: "M6-B 集成测试维修记录正文，用于覆盖评论管理。",
      result: "COMPLETED",
      remark: null,
    },
    owner,
  );
}

function hasCode(error: unknown, code: ApiErrorCode): boolean {
  return error instanceof AppError && error.code === code;
}
