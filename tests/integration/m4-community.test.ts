import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { repairCommentService } from "../../src/features/community/comment-service";
import { repairFavoriteService } from "../../src/features/community/favorite-service";
import { notificationService } from "../../src/features/community/notification-service";
import { memberDashboardService } from "../../src/features/member-dashboard/member-dashboard-service";
import { memberService } from "../../src/features/members/member-service";
import { repairService } from "../../src/features/repairs/repair-service";
import { repairPhotoService } from "../../src/features/repairs/repair-photo-service";
import { repairReviewService } from "../../src/features/repairs/repair-review-service";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { digestSessionToken } from "../../src/lib/security/secrets";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";

/* 集成测试的统一闸门：指向非测试库时**在加载阶段就抛错**（`db-guard.ts` 里写了两次
   实际事故）。未开启时返回 false，各文件照常走 test.skip。 */
const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * 独立 UUID 段，避免与 M2（10000000）/ M3（b3000000）共享 fixture 互相清空。
 * 清理一律按 realName 前缀 "M4 " 限定。
 */
const adminId = "c4000000-0000-4000-8000-000000000001";
const adminProfileId = "c4000000-0000-4000-8000-000000000002";
const categoryId = "c4000000-0000-4000-8000-000000000003";

let uploadTestRoot = "";

async function prepareFixtures(): Promise<void> {
  const db = getDb();
  await db.notification.deleteMany({
    where: { recipient: { realName: { startsWith: "M4 " } } },
  });
  await db.commentMention.deleteMany({
    where: { comment: { record: { memberProfile: { realName: { startsWith: "M4 " } } } } },
  });
  // repair_comments 有自引用外键（回复 → 根评论，onDelete: Restrict）。InnoDB 外键
  // 是**逐行即时检查**、没有 deferred 约束，直接 deleteMany 会在删到根评论时被子回复
  // 挡住（`Foreign key constraint violated on the fields: ('parent_comment_id')`）。
  // 故先把本次清理范围内的回复拍平（parent_comment_id 置空，字段本就可空），再整批删除。
  await db.repairComment.updateMany({
    where: { record: { memberProfile: { realName: { startsWith: "M4 " } } } },
    data: { parentCommentId: null },
  });
  await db.repairComment.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M4 " } } } },
  });
  await db.repairFavorite.deleteMany({
    where: { memberProfile: { realName: { startsWith: "M4 " } } },
  });
  await db.repairTimelineEvent.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M4 " } } } },
  });
  await db.repairReview.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M4 " } } } },
  });
  await db.repairPhoto.deleteMany({
    where: { record: { memberProfile: { realName: { startsWith: "M4 " } } } },
  });
  await db.repairRecord.deleteMany({
    where: { memberProfile: { realName: { startsWith: "M4 " } } },
  });
  await db.userSkill.deleteMany({ where: { memberProfile: { realName: { startsWith: "M4 " } } } });
  await db.auditLog.deleteMany({
    where: { action: { startsWith: "repair.comment." } },
  });
  await db.auditLog.deleteMany({
    where: { action: { startsWith: "repair.favorite." } },
  });

  await ensureUser(adminId, "M4 Admin");
  await ensureMemberProfile(adminProfileId, adminId, "M4 Admin");
  await ensureRepairCategory(categoryId, "M4_TEST", "M4 测试分类");
}

before(async () => {
  if (!enabled) return;
  uploadTestRoot = await mkdtemp(join(tmpdir(), "pc-hospital-m4-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
  await prepareFixtures();
});

beforeEach(async () => {
  if (!enabled) return;
  await prepareFixtures();
});

after(async () => {
  if (enabled) {
    await disconnectDb();
    if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
  }
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

const adminActor: AuthorizedActor = {
  actorType: "USER",
  userId: adminId,
  userStatus: "ACTIVE",
  permissions: permissionsForRoles(["ADMIN"]),
  requestId: "req_m4_admin",
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

let memberSeq = 0;
async function createMember(label: string, nickname?: string) {
  memberSeq += 1;
  const tail = `${Date.now()}`.slice(-5);
  const serial = `${tail}${String(memberSeq).padStart(3, "0")}`.slice(-8);
  return memberService.create(
    {
      realName: `M4 ${label}`,
      nickname,
      qq: `7${serial}`,
      phone: `138${serial}`,
      idempotencyKey: randomUUID(),
    },
    adminActor,
  );
}

async function createApprovedRepair(
  owner: AuthorizedActor,
  options: { repairDate?: string; durationMinutes?: number } = {},
) {
  const key = randomUUID();
  const draft = await repairService.createDraft({ idempotencyKey: key }, owner);
  const category = await getDb().repairCategory.findUniqueOrThrow({ where: { code: "M4_TEST" } });
  const updated = await repairService.update(
    draft.id,
    {
      version: draft.version,
      repairDate: options.repairDate ?? new Date().toISOString().slice(0, 10),
      durationMinutes: options.durationMinutes ?? 30,
      categoryId: category.id,
      content: "M4 集成测试维修记录正文内容，用于覆盖评论与收藏。",
      result: "COMPLETED",
    },
    owner,
  );
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  await repairPhotoService.upload(
    draft.id,
    [new File([png], "m4-case.png", { type: "image/png" })],
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

async function createSessionToken(userId: string): Promise<string> {
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const now = new Date();
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

/**
 * 调用一个 Route Handler。
 *
 * `Params` 从 `handler` 的第二个参数反推：`/api/v1/repairs/[id]/...` 这类动态段
 * 路由把 `params` 声明为**必填**（`type Context = { params: Promise<{ id: string }> }`），
 * 若这里写成可选，传入的处理器会因参数逆变而不满足签名。
 * 无参数路由只声明一个形参，`Params` 取默认值即可，多传一个实参不影响运行。
 */
async function callRoute<Params extends Record<string, string> = Record<string, string>>(
  handler: (request: Request, context: { params: Promise<Params> }) => Promise<Response>,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    params?: Params;
  } = {},
): Promise<{ status: number; json: Record<string, unknown>; cacheControl: string | null }> {
  const parsed = new URL(url);
  const request = new Request(url, {
    method: init.method ?? "GET",
    headers: {
      origin: parsed.origin,
      "x-forwarded-host": parsed.host,
      host: parsed.host,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const response = await handler(request, {
    params: Promise.resolve(init.params ?? ({} as Params)),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json, cacheControl: response.headers.get("cache-control") };
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code;
}

dbTest("M4 回复超过两层时拍平到根评论", async () => {
  const owner = await createMember("作者");
  const actor = memberActor(owner.member.userId, "req_m4_flatten");
  const record = await createApprovedRepair(actor);

  const root = await repairCommentService.create(
    record.id,
    { body: "这是根评论内容足够长" },
    actor,
  );
  const reply = await repairCommentService.create(
    record.id,
    { body: "这是直接回复内容足够长", parentCommentId: root.id },
    actor,
  );
  const nested = await repairCommentService.create(
    record.id,
    { body: "这是嵌套回复应挂到根", parentCommentId: reply.id },
    actor,
  );

  assert.equal(root.parentCommentId, null);
  assert.equal(reply.parentCommentId, root.id);
  assert.equal(nested.parentCommentId, root.id);

  const listed = await repairCommentService.list(record.id, { page: 1, pageSize: 20 }, actor);
  assert.equal(listed.pagination.total, 1);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.id, root.id);
  assert.equal(listed.items[0]?.replies.length, 2);
  assert.deepEqual(
    listed.items[0]?.replies.map((item) => item.id).sort(),
    [reply.id, nested.id].sort(),
  );
});

dbTest("M4 评论按根评论分页，且每页只带本页根评论的回复", async () => {
  const owner = await createMember("分页作者");
  const actor = memberActor(owner.member.userId, "req_m4_paging");
  const record = await createApprovedRepair(actor);

  // 3 条根评论，每条挂 1 条回复
  const roots: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const root = await repairCommentService.create(
      record.id,
      { body: `第 ${index} 条根评论内容足够长` },
      actor,
    );
    await repairCommentService.create(
      record.id,
      { body: `第 ${index} 条回复内容足够长`, parentCommentId: root.id },
      actor,
    );
    roots.push(root.id);
  }

  const page1 = await repairCommentService.list(record.id, { page: 1, pageSize: 2 }, actor);
  const page2 = await repairCommentService.list(record.id, { page: 2, pageSize: 2 }, actor);

  // total 只数根评论（回复不计入），回复必须跟着它所属的根评论一起返回。
  // 分页已下推到 SQL，回复改为「只查本页根评论的那些」—— 这条用例就是那个改动的回归网。
  assert.equal(page1.pagination.total, 3);
  assert.equal(page1.pagination.totalPages, 2);
  assert.equal(page1.items.length, 2);
  assert.equal(page2.items.length, 1);

  const listedIds = [...page1.items, ...page2.items].map((item) => item.id);
  assert.equal(new Set(listedIds).size, listedIds.length, "两页出现重复的根评论");
  assert.deepEqual([...listedIds].sort(), [...roots].sort(), "两页合起来应覆盖全部根评论");

  for (const item of [...page1.items, ...page2.items]) {
    assert.equal(item.replies.length, 1, `根评论 ${item.id} 的回复没有被带出`);
    assert.equal(item.replies[0]?.parentCommentId, item.id);
  }

  // 越界页返回空列表而不是报错
  const page3 = await repairCommentService.list(record.id, { page: 3, pageSize: 2 }, actor);
  assert.deepEqual(page3.items, []);
  assert.equal(page3.pagination.total, 3);
});

dbTest("M4 @成员与显式 ID 并集会通知，提及优先于记录评论通知", async () => {
  const ownerCreated = await createMember("记录主人", "主人");
  const mentionedCreated = await createMember("被提及", "小林");
  const commenterCreated = await createMember("评论者", "评论者");
  const owner = memberActor(ownerCreated.member.userId, "req_m4_owner");
  const mentioned = memberActor(mentionedCreated.member.userId, "req_m4_mentioned");
  const commenter = memberActor(commenterCreated.member.userId, "req_m4_commenter");
  const record = await createApprovedRepair(owner);

  const comment = await repairCommentService.create(
    record.id,
    {
      body: "请 @小林 看一下这台机器",
      mentionedMemberProfileIds: [mentionedCreated.member.id],
    },
    commenter,
  );
  assert.equal(comment.mentions.length, 1);
  assert.equal(comment.mentions[0]?.id, mentionedCreated.member.id);

  const mentionedInbox = await notificationService.list({ page: 1, pageSize: 20 }, mentioned);
  const ownerInbox = await notificationService.list({ page: 1, pageSize: 20 }, owner);
  const selfInbox = await notificationService.list({ page: 1, pageSize: 20 }, commenter);

  assert.equal(
    mentionedInbox.items.some((item) => item.type === "MENTIONED" && item.commentId === comment.id),
    true,
  );
  assert.equal(
    ownerInbox.items.some(
      (item) => item.type === "REPAIR_COMMENTED" && item.commentId === comment.id,
    ),
    true,
  );
  assert.equal(
    selfInbox.items.some((item) => item.commentId === comment.id),
    false,
    "作者不应收到自己的评论通知",
  );

  const ownerMentioned = await repairCommentService.create(
    record.id,
    { body: "请 @主人 自己看一眼" },
    commenter,
  );
  const ownerAfter = await notificationService.list({ page: 1, pageSize: 50 }, owner);
  const related = ownerAfter.items.filter((item) => item.commentId === ownerMentioned.id);
  assert.equal(related.length, 1);
  assert.equal(related[0]?.type, "MENTIONED");
});

dbTest("M4 未知显式提及 ID 拒绝，超限拒绝不截断", async () => {
  const created = await createMember("提及校验");
  const actor = memberActor(created.member.userId, "req_m4_mention_limit");
  const record = await createApprovedRepair(actor);

  await assert.rejects(
    () =>
      repairCommentService.create(
        record.id,
        { body: "提及一个不存在的人", mentionedMemberProfileIds: [randomUUID()] },
        actor,
      ),
    (error) => hasCode(error, "VALIDATION_FAILED"),
  );

  const extras: Awaited<ReturnType<typeof createMember>>[] = [];
  for (let index = 0; index < 11; index += 1) {
    extras.push(await createMember(`提及${index}`, `提及${index}`));
  }
  await assert.rejects(
    () =>
      repairCommentService.create(
        record.id,
        {
          body: extras.map((item) => `@${item.member.nickname}`).join(" "),
          mentionedMemberProfileIds: extras.map((item) => item.member.id),
        },
        actor,
      ),
    (error) => hasCode(error, "MENTION_LIMIT_EXCEEDED"),
  );
});

dbTest("M4 通知已读幂等、全部已读与软删除不改状态", async () => {
  const created = await createMember("通知收件");
  const actor = memberActor(created.member.userId, "req_m4_read");
  await createApprovedRepair(actor);
  await createApprovedRepair(actor);

  const before = await notificationService.list({ page: 1, pageSize: 20, status: "UNREAD" }, actor);
  assert.equal(before.unreadCount, 2);
  const first = before.items[0];
  assert.ok(first);

  const marked = await notificationService.markRead(first.id, actor);
  assert.equal(marked.status, "READ");
  const again = await notificationService.markRead(first.id, actor);
  assert.equal(again.status, "READ");
  assert.equal(again.readAt, marked.readAt);

  const afterOne = await notificationService.list({ page: 1, pageSize: 20 }, actor);
  assert.equal(afterOne.unreadCount, 1);

  const all = await notificationService.markAllRead(actor);
  assert.equal(all.updatedCount, 1);
  const emptyUnread = await notificationService.list(
    { page: 1, pageSize: 20, status: "UNREAD" },
    actor,
  );
  assert.equal(emptyUnread.unreadCount, 0);
  assert.equal(emptyUnread.items.length, 0);

  await notificationService.softDelete(first.id, actor);
  const remaining = await notificationService.list({ page: 1, pageSize: 20 }, actor);
  assert.equal(
    remaining.items.some((item) => item.id === first.id),
    false,
  );
  const stored = await getDb().notification.findUniqueOrThrow({ where: { id: first.id } });
  assert.notEqual(stored.deletedAt, null);
  assert.equal(stored.status, "READ");
});

dbTest("M4 收藏取消走软删除，再次收藏恢复同一行并刷新时间", async () => {
  const created = await createMember("收藏者");
  const actor = memberActor(created.member.userId, "req_m4_fav");
  const record = await createApprovedRepair(actor);

  const first = await repairFavoriteService.add(record.id, actor);
  const listed = await repairFavoriteService.list({ page: 1, pageSize: 20 }, actor);
  assert.equal(listed.pagination.total, 1);
  assert.equal(listed.items[0]?.id, first.id);

  await repairFavoriteService.remove(record.id, actor);
  const afterRemove = await repairFavoriteService.list({ page: 1, pageSize: 20 }, actor);
  assert.equal(afterRemove.pagination.total, 0);
  const soft = await getDb().repairFavorite.findUniqueOrThrow({ where: { id: first.id } });
  assert.notEqual(soft.deletedAt, null);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const restored = await repairFavoriteService.add(record.id, actor);
  assert.equal(restored.id, first.id);
  const live = await getDb().repairFavorite.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(live.deletedAt, null);
  assert.ok(live.createdAt.getTime() >= soft.createdAt.getTime());

  const dashboard = await memberDashboardService.getDashboard(actor);
  assert.equal(dashboard.favorites.available, true);
  assert.equal(dashboard.favorites.count, 1);
  assert.equal(dashboard.favorites.latest[0]?.id, first.id);
});

dbTest("M4 作者可删自己的评论，其他成员越权被拒，管理员可删", async () => {
  const authorCreated = await createMember("评论作者");
  const otherCreated = await createMember("其他成员");
  const author = memberActor(authorCreated.member.userId, "req_m4_author");
  const other = memberActor(otherCreated.member.userId, "req_m4_other");
  const record = await createApprovedRepair(author);

  const comment = await repairCommentService.create(
    record.id,
    { body: "这条评论随后会被删除" },
    author,
  );
  await assert.rejects(
    () => repairCommentService.softDelete(record.id, comment.id, other),
    (error) => hasCode(error, "FORBIDDEN"),
  );
  await repairCommentService.softDelete(record.id, comment.id, author);
  const afterSelf = await repairCommentService.list(record.id, { page: 1, pageSize: 20 }, author);
  assert.equal(afterSelf.items.length, 0);

  const second = await repairCommentService.create(
    record.id,
    { body: "管理员将删除这条评论" },
    author,
  );
  await repairCommentService.softDelete(record.id, second.id, adminActor);
  const afterAdmin = await repairCommentService.list(record.id, { page: 1, pageSize: 20 }, author);
  assert.equal(afterAdmin.items.length, 0);
  const stored = await getDb().repairComment.findUniqueOrThrow({ where: { id: second.id } });
  assert.notEqual(stored.deletedAt, null);
});

dbTest("M4 不能评论他人未通过记录，不能操作他人通知或收藏", async () => {
  const ownerCreated = await createMember("草稿主人");
  const otherCreated = await createMember("旁观者");
  const owner = memberActor(ownerCreated.member.userId, "req_m4_draft_owner");
  const other = memberActor(otherCreated.member.userId, "req_m4_draft_other");
  const draft = await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);

  await assert.rejects(
    () => repairCommentService.create(draft.id, { body: "不应出现在他人草稿上" }, other),
    (error) => hasCode(error, "REPAIR_NOT_FOUND"),
  );
  await assert.rejects(
    () => repairFavoriteService.add(draft.id, other),
    (error) => hasCode(error, "REPAIR_NOT_FOUND"),
  );

  const approved = await createApprovedRepair(owner);
  const ownerNotice = await notificationService.list({ page: 1, pageSize: 20 }, owner);
  const notice = ownerNotice.items[0];
  assert.ok(notice);
  await assert.rejects(
    () => notificationService.markRead(notice.id, other),
    (error) => hasCode(error, "NOTIFICATION_NOT_FOUND"),
  );
  await assert.rejects(
    () => notificationService.softDelete(notice.id, other),
    (error) => hasCode(error, "NOTIFICATION_NOT_FOUND"),
  );

  const favorite = await repairFavoriteService.add(approved.id, owner);
  await assert.rejects(
    () => repairFavoriteService.remove(approved.id, other),
    (error) => hasCode(error, "FAVORITE_NOT_FOUND"),
  );
  assert.equal(favorite.repairRecordId, approved.id);
});

dbTest("M4 HTTP 评论/通知/收藏信封固定且写接口校验同源", async () => {
  const created = await createMember("信封");
  const actor = memberActor(created.member.userId, "req_m4_http");
  const token = await createSessionToken(created.member.userId);
  const record = await createApprovedRepair(actor);
  const cookie = { cookie: `pc_hospital_session=${token}` };

  const { GET: listComments, POST: createComment } =
    await import("../../src/app/api/v1/repairs/[id]/comments/route");
  const createdComment = await callRoute(
    createComment,
    `http://localhost/api/v1/repairs/${record.id}/comments`,
    {
      method: "POST",
      headers: cookie,
      body: { body: "通过 HTTP 发表的内部评论内容" },
      params: { id: record.id },
    },
  );
  assert.equal(createdComment.status, 201, JSON.stringify(createdComment.json));
  assert.equal(createdComment.cacheControl, "private, no-store");
  const commentData = createdComment.json.data as { id: string; body: string };
  assert.equal(commentData.body, "通过 HTTP 发表的内部评论内容");

  const listed = await callRoute(
    listComments,
    `http://localhost/api/v1/repairs/${record.id}/comments`,
    {
      headers: cookie,
      params: { id: record.id },
    },
  );
  assert.equal(listed.status, 200);
  assert.equal(listed.cacheControl, "private, no-store");
  assert.equal(Array.isArray(listed.json.data), true);

  const { GET: listNotifications } =
    await import("../../src/app/api/v1/member/notifications/route");
  const notices = await callRoute(
    listNotifications,
    "http://localhost/api/v1/member/notifications",
    {
      headers: cookie,
    },
  );
  assert.equal(notices.status, 200);
  const noticeData = notices.json.data as { items: unknown[]; unreadCount: number };
  assert.equal(Array.isArray(noticeData.items), true);
  assert.equal(typeof noticeData.unreadCount, "number");

  const { POST: addFavorite } = await import("../../src/app/api/v1/member/favorites/route");
  const favorited = await callRoute(addFavorite, "http://localhost/api/v1/member/favorites", {
    method: "POST",
    headers: cookie,
    body: { repairRecordId: record.id },
  });
  assert.equal(favorited.status, 201, JSON.stringify(favorited.json));

  const unauth = await callRoute(listNotifications, "http://localhost/api/v1/member/notifications");
  assert.equal(unauth.status, 401);
  assert.equal(unauth.json.success, false);
  assert.equal("data" in unauth.json, false);
});
