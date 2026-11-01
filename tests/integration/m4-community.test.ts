import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { repairFavoriteService } from "../../src/features/community/favorite-service";
import {
  notificationService,
  summarizeNotifications,
} from "../../src/features/community/notification-service";
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
import { TINY_PNG_BYTES } from "../support/image-fixtures";
import { integrationTestsEnabled } from "./db-guard";
import { sameOriginHeaders } from "./http-harness";

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
  // 参与行先于记录删除：本文件的记录走 `repairService` 创建，带参与行。
  await db.repairRecordParticipant.deleteMany({
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
      deviceModel: "M4 测试机型",
      ownerName: "M4 集成机主",
      ownerPhone: "13800138004",
      content: "M4 集成测试维修记录正文内容，用于覆盖通知与收藏。",
      result: "COMPLETED",
    },
    owner,
  );
  const png = TINY_PNG_BYTES;
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
      // 写接口会走 assertSameOrigin()，它只认 APP_BASE_URL 白名单，见 sameOriginHeaders()。
      ...sameOriginHeaders(),
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

dbTest("M4 不能收藏他人未通过记录，不能操作他人通知或收藏", async () => {
  const ownerCreated = await createMember("草稿主人");
  const otherCreated = await createMember("旁观者");
  const owner = memberActor(ownerCreated.member.userId, "req_m4_draft_owner");
  const other = memberActor(otherCreated.member.userId, "req_m4_draft_other");
  const draft = await repairService.createDraft({ idempotencyKey: randomUUID() }, owner);

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

dbTest("M4 HTTP 通知/收藏信封固定", async () => {
  const created = await createMember("信封");
  const actor = memberActor(created.member.userId, "req_m4_http");
  const token = await createSessionToken(created.member.userId);
  const record = await createApprovedRepair(actor);
  const cookie = { cookie: `pc_hospital_session=${token}` };

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

dbTest(
  "#198 混合历史通知：查询、分页、摘要和写操作只开放审核类型，历史行及他人消息保留",
  async () => {
    const created = await createMember("历史通知");
    const other = await createMember("其他收件人");
    const actor = memberActor(created.member.userId, "req_198_notifications");
    const record = await createApprovedRepair(actor);
    const oldAt = new Date("2026-01-01T00:00:00Z");
    const comment = await getDb().repairComment.create({
      data: {
        id: randomUUID(),
        repairRecordId: record.id,
        authorMemberProfileId: created.member.id,
        body: "仅历史夹具，不通过退役接口创建",
        createdAt: oldAt,
      },
    });
    const hiddenIds: string[] = [];
    for (const type of ["MENTIONED", "REPAIR_COMMENTED"]) {
      for (const status of ["UNREAD", "READ"]) {
        const id = randomUUID();
        hiddenIds.push(id);
        await getDb().notification.create({
          data: {
            id,
            type,
            status,
            recipientMemberProfileId: created.member.id,
            repairRecordId: record.id,
            commentId: comment.id,
            createdAt: oldAt,
            readAt: status === "READ" ? oldAt : null,
          },
        });
      }
    }
    const rejected = await getDb().notification.create({
      data: {
        id: randomUUID(),
        type: "REPAIR_REJECTED",
        status: "READ",
        readAt: oldAt,
        recipientMemberProfileId: created.member.id,
        repairRecordId: record.id,
        // 兼容字段即使历史上有值，对客户端也必须为 null。
        commentId: comment.id,
        createdAt: oldAt,
      },
    });
    const otherNotice = await getDb().notification.create({
      data: {
        id: randomUUID(),
        type: "REPAIR_APPROVED",
        status: "UNREAD",
        recipientMemberProfileId: other.member.id,
        createdAt: oldAt,
      },
    });
    const historical = () =>
      getDb().notification.findMany({
        where: { id: { in: [...hiddenIds, otherNotice.id] } },
        orderBy: { id: "asc" },
      });
    const before = await historical();
    const first = await notificationService.list({ page: 1, pageSize: 1 }, actor);
    const second = await notificationService.list({ page: 2, pageSize: 1 }, actor);
    assert.equal(first.pagination.total, 2);
    assert.equal(first.pagination.totalPages, 2);
    assert.equal(first.unreadCount, 1);
    assert.equal(second.items[0].id, rejected.id);
    assert.ok([...first.items, ...second.items].every((item) => item.commentId === null));
    const unread = await notificationService.list(
      { page: 1, pageSize: 20, status: "UNREAD" },
      actor,
    );
    assert.equal(unread.pagination.total, 1);
    const summary = await summarizeNotifications(created.member.id, actor);
    assert.equal(summary.unreadCount, 1);
    assert.equal(summary.latest.length, 2);
    const dashboard = await memberDashboardService.getDashboard(actor);
    assert.equal(dashboard.notifications.available, true);
    assert.equal(dashboard.notifications.unreadCount, 1);
    assert.equal(dashboard.notifications.latest.length, 2);
    for (const id of hiddenIds) {
      await assert.rejects(notificationService.markRead(id, actor), (error) =>
        hasCode(error, "NOTIFICATION_NOT_FOUND"),
      );
      await assert.rejects(notificationService.softDelete(id, actor), (error) =>
        hasCode(error, "NOTIFICATION_NOT_FOUND"),
      );
    }
    assert.equal((await notificationService.markAllRead(actor)).updatedCount, 1);
    assert.deepEqual(await historical(), before);
    assert.equal(await getDb().repairComment.count({ where: { id: comment.id } }), 1);
    await notificationService.softDelete(rejected.id, actor);
    assert.equal(
      (await notificationService.list({ page: 1, pageSize: 20 }, actor)).pagination.total,
      1,
    );
  },
);

dbTest("#198 五个旧评论方法统一退役：正常请求 404、正文不解析、历史内容不变", async () => {
  const created = await createMember("退役接口");
  const actor = memberActor(created.member.userId, "req_198_retired");
  const token = await createSessionToken(created.member.userId);
  const record = await createApprovedRepair(actor);
  const historical = await getDb().repairComment.create({
    data: {
      id: randomUUID(),
      repairRecordId: record.id,
      authorMemberProfileId: created.member.id,
      body: "必须保留的历史内容",
      createdAt: new Date(),
    },
  });
  const comments = await import("../../src/app/api/v1/repairs/[id]/comments/route");
  const single = await import("../../src/app/api/v1/repairs/[id]/comments/[commentId]/route");
  const admin = await import("../../src/app/api/v1/admin/comments/route");
  const adminSingle = await import("../../src/app/api/v1/admin/comments/[id]/route");
  // 不存在的目标 + 畸形 JSON 仍是退役响应，不做目标查询或正文校验。
  for (const [method, handler, path] of [
    ["GET", comments.GET, "/repairs/nonexistent/comments"],
    ["POST", comments.POST, "/repairs/nonexistent/comments"],
    ["DELETE", single.DELETE, `/repairs/${record.id}/comments/${historical.id}`],
    ["GET", admin.GET, "/admin/comments?invalid=pagination"],
    ["DELETE", adminSingle.DELETE, `/admin/comments/${historical.id}`],
  ] as const) {
    const response = await handler(
      new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: {
          ...sameOriginHeaders(),
          cookie: `pc_hospital_session=${token}`,
          "x-request-id": "req_198_retired",
        },
        ...(method === "POST" ? { body: "not-json" } : {}),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "RESOURCE_NOT_FOUND");
    assert.equal(body.meta.requestId, "req_198_retired");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  const anonymous = await comments.GET(new Request("http://localhost/api/v1/repairs/any/comments"));
  assert.equal(anonymous.status, 401);
  const crossOrigin = await comments.POST(
    new Request("http://localhost/api/v1/repairs/any/comments", {
      method: "POST",
      headers: { origin: "https://untrusted.test", cookie: `pc_hospital_session=${token}` },
      body: "not-json",
    }),
  );
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(
    await getDb().repairComment.findUniqueOrThrow({ where: { id: historical.id } }),
    historical,
  );
  assert.equal(
    await getDb().auditLog.count({ where: { action: { startsWith: "repair.comment." } } }),
    0,
  );
});
