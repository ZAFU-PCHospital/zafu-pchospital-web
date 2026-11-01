import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { POST as uploadRoute } from "../../src/app/api/v1/repairs/[id]/photos/route";
import { repairPhotoUploadGate } from "../../src/features/repairs/repair-photo-admission";
import {
  createRepairPhotoService,
  repairPhotoService,
} from "../../src/features/repairs/repair-photo-service";
import { repairQueryService } from "../../src/features/repairs/repair-query-service";
import { repairReviewService } from "../../src/features/repairs/repair-review-service";
import { repairService } from "../../src/features/repairs/repair-service";
import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles } from "../../src/lib/auth/permissions";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { TINY_PNG_BYTES } from "../support/image-fixtures";
import { integrationTestsEnabled } from "./db-guard";
import { sameOriginHeaders, sessionCookie } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;

/**
 * 审核前补照片（真实 GreatSQL）。
 *
 * 覆盖：本人未审核 PENDING 的上传 / 排序 / 删除、审核通过关闭窗口、退回后恢复、
 * 非本人 / 管理员不代传、软删除拒绝，以及「文件已写入但审核先完成」的竞态回滚。
 *
 * 独立前缀 "PHOTO226 "；测试上传目录在系统临时目录，结束后删除。
 */
const PREFIX = "PHOTO226 ";
const SEED_TIME = new Date("2026-09-21T00:00:00.000Z");

type Member = { userId: string; profileId: string };
type Admin = { userId: string; actor: AuthorizedActor };

let uploadTestRoot = "";

function ownerActor(member: Member): AuthorizedActor {
  return {
    actorType: "USER",
    userId: member.userId,
    userStatus: "ACTIVE",
    permissions: permissionsForRoles(["MEMBER"]),
    requestId: "req_photo226_owner",
  };
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

function pngFile(name: string): File {
  return new File([TINY_PNG_BYTES], name, { type: "image/png" });
}

async function cleanupFixtures(): Promise<void> {
  const db = getDb();
  const profiles = await db.memberProfile.findMany({
    where: { realName: { startsWith: PREFIX } },
    select: { id: true, userId: true },
  });
  const profileIds = profiles.map((row) => row.id);
  const records = await db.repairRecord.findMany({
    where: { memberProfileId: { in: profileIds } },
    select: { id: true },
  });
  const recordIds = records.map((row) => row.id);
  const users = await db.user.findMany({
    where: { displayName: { startsWith: PREFIX } },
    select: { id: true },
  });
  const userIds = [
    ...new Set([...profiles.map((row) => row.userId), ...users.map((row) => row.id)]),
  ];

  await db.notification.deleteMany({
    where: {
      OR: [{ repairRecordId: { in: recordIds } }, { recipientMemberProfileId: { in: profileIds } }],
    },
  });
  await db.repairTimelineEvent.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairReview.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairRecordParticipant.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.repairPhoto.deleteMany({ where: { repairRecordId: { in: recordIds } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { targetType: "RepairRecord", targetId: { in: recordIds } },
        { actorUserId: { in: userIds } },
      ],
    },
  });
  await db.repairRecord.deleteMany({ where: { id: { in: recordIds } } });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.memberProfile.deleteMany({ where: { id: { in: profileIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

async function getOrCreateSystemCategory(): Promise<string> {
  const db = getDb();
  const existing = await db.repairCategory.findUnique({ where: { code: "SYSTEM" } });
  if (existing) return existing.id;
  const id = randomUUID();
  await db.repairCategory.create({
    data: {
      id,
      code: "SYSTEM",
      name: "系统问题",
      sortOrder: 90,
      isActive: true,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  return id;
}

async function createMember(label: string): Promise<Member> {
  const db = getDb();
  const userId = randomUUID();
  const profileId = randomUUID();
  await db.user.create({
    data: {
      id: userId,
      status: "ACTIVE",
      displayName: `${PREFIX}${label}`,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  await db.memberProfile.create({
    data: {
      id: profileId,
      userId,
      realName: `${PREFIX}${label}`,
      status: "ACTIVE",
      joinedAt: SEED_TIME,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  return { userId, profileId };
}

async function createAdmin(): Promise<Admin> {
  const db = getDb();
  const userId = randomUUID();
  await db.user.create({
    data: {
      id: userId,
      status: "ACTIVE",
      displayName: `${PREFIX}管理员`,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  return {
    userId,
    actor: {
      actorType: "USER",
      userId,
      userStatus: "ACTIVE",
      permissions: permissionsForRoles(["ADMIN"]),
      requestId: "req_photo226_admin",
    },
  };
}

async function createPendingRecord(memberProfileId: string): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const categoryId = await getOrCreateSystemCategory();
  await db.repairRecord.create({
    data: {
      id,
      memberProfileId,
      status: "PENDING",
      createRequestKey: `photo226:${id}`,
      repairDate: new Date("2026-10-01T00:00:00.000Z"),
      durationMinutes: 30,
      categoryId,
      deviceModel: "X1 Carbon",
      ownerName: "PHOTO226 机主",
      ownerPhone: "13900002222",
      content: null,
      result: "COMPLETED",
      remark: null,
      submittedAt: SEED_TIME,
      reviewedAt: null,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    },
  });
  await db.repairRecordParticipant.create({
    data: {
      id: randomUUID(),
      repairRecordId: id,
      memberProfileId,
      sortOrder: 0,
      createdAt: SEED_TIME,
    },
  });
  return id;
}

async function activePhotos(recordId: string) {
  return getDb().repairPhoto.findMany({
    where: { repairRecordId: recordId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, sortOrder: true },
  });
}

function assertContiguous(rows: Array<{ sortOrder: number }>) {
  assert.deepEqual(
    rows.map((row) => row.sortOrder),
    rows.map((_, index) => index),
    "有效照片序号必须连续为 0..n-1",
  );
}

before(async () => {
  if (!enabled) return;
  uploadTestRoot = await mkdtemp(join(tmpdir(), "pc226-photos-"));
  process.env.UPLOAD_PATH = uploadTestRoot;
  await cleanupFixtures();
});

beforeEach(async () => {
  if (!enabled) return;
  await cleanupFixtures();
});

after(async () => {
  if (!enabled) return;
  await cleanupFixtures();
  if (uploadTestRoot) await rm(uploadTestRoot, { recursive: true, force: true });
  await disconnectDb();
});

dbTest("上传准入：队列占满时 429 且不解析 multipart，释放后可继续上传", async () => {
  const member = await createMember("上传准入");
  const recordId = await createPendingRecord(member.profileId);
  const cookie = await sessionCookie(member.userId, "MEMBER");
  const url = `http://localhost/api/v1/repairs/${recordId}/photos`;

  let parsed = 0;
  const blocked = new Request(url, {
    method: "POST",
    headers: { cookie, ...sameOriginHeaders() },
    body: "--blocked--",
  });
  Object.defineProperty(blocked, "formData", {
    value: async () => {
      parsed += 1;
      return new FormData();
    },
  });

  const releaseActive = await repairPhotoUploadGate.acquire();
  const waiting = repairPhotoUploadGate.acquire();
  try {
    const response = await uploadRoute(blocked, { params: Promise.resolve({ id: recordId }) });
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(response.status, 429, JSON.stringify(body));
    assert.equal(body.error?.code, "RATE_LIMITED");
    assert.equal(parsed, 0, "准入拒绝的请求不应继续解析 multipart");
  } finally {
    releaseActive();
  }
  (await waiting)();

  const form = new FormData();
  form.append("photos", pngFile("admitted.png"));
  const allowed = await uploadRoute(
    new Request(url, {
      method: "POST",
      headers: { cookie, ...sameOriginHeaders() },
      body: form,
    }),
    { params: Promise.resolve({ id: recordId }) },
  );
  const allowedBody = (await allowed.json()) as { success?: boolean };
  assert.equal(allowed.status, 201, JSON.stringify(allowedBody));
  assert.equal(allowedBody.success, true);
  assert.equal((await activePhotos(recordId)).length, 1);
  assert.deepEqual(repairPhotoUploadGate.snapshot(), { active: 0, waiting: 0 });
});

dbTest("PENDING 未审核：本人可上传、排序、删除照片", async () => {
  const member = await createMember("本人补传");
  const owner = ownerActor(member);
  const recordId = await createPendingRecord(member.profileId);
  const detail = await repairQueryService.getById(recordId, owner);
  assert.equal(detail.canAttachPhotos, true);

  const uploaded = await repairPhotoService.upload(
    recordId,
    [pngFile("a.png"), pngFile("b.png")],
    owner,
  );
  assert.equal(uploaded.length, 2);
  assert.deepEqual(
    uploaded.map((photo) => photo.sortOrder),
    [0, 1],
  );

  const reordered = await repairPhotoService.reorder(recordId, uploaded[1]!.id, 0, owner);
  assert.equal(reordered.sortOrder, 0);
  const rows = await getDb().repairPhoto.findMany({
    where: { repairRecordId: recordId, deletedAt: null },
    orderBy: { sortOrder: "asc" },
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    [uploaded[1]!.id, uploaded[0]!.id],
  );

  await repairPhotoService.remove(recordId, uploaded[0]!.id, owner);
  assert.equal(
    await getDb().repairPhoto.count({ where: { repairRecordId: recordId, deletedAt: null } }),
    1,
  );
  assert.equal(
    await getDb().repairTimelineEvent.count({
      where: { repairRecordId: recordId, eventType: "PHOTO_ADDED" },
    }),
    1,
  );
});

dbTest("删除中间照片后补传：序号连续，详情顺序与刷新一致（issue #235）", async () => {
  const member = await createMember("顺序补传");
  const owner = ownerActor(member);
  const recordId = await createPendingRecord(member.profileId);
  const uploaded = await repairPhotoService.upload(
    recordId,
    [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")],
    owner,
  );
  assert.deepEqual(
    uploaded.map((photo) => photo.sortOrder),
    [0, 1, 2],
  );

  await repairPhotoService.remove(recordId, uploaded[1]!.id, owner);
  let rows = await activePhotos(recordId);
  assert.deepEqual(
    rows.map((row) => row.id),
    [uploaded[0]!.id, uploaded[2]!.id],
  );
  assertContiguous(rows);

  const appended = await repairPhotoService.upload(recordId, [pngFile("d.png")], owner);
  assert.equal(appended[0]!.sortOrder, 2, "补传接在末尾，不能复用已释放的中间序号");
  rows = await activePhotos(recordId);
  assert.deepEqual(
    rows.map((row) => row.id),
    [uploaded[0]!.id, uploaded[2]!.id, appended[0]!.id],
  );
  assertContiguous(rows);

  const detail = await repairQueryService.getById(recordId, owner);
  assert.deepEqual(
    detail.photos.map((photo) => photo.id),
    rows.map((row) => row.id),
    "详情顺序应与刷新后的数据库顺序一致",
  );
});

dbTest("删除后上移 / 下移：按数组位置移动且序号连续（issue #235）", async () => {
  const member = await createMember("删除后换序");
  const owner = ownerActor(member);
  const recordId = await createPendingRecord(member.profileId);
  const uploaded = await repairPhotoService.upload(
    recordId,
    [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")],
    owner,
  );
  await repairPhotoService.remove(recordId, uploaded[1]!.id, owner);

  const movedUp = await repairPhotoService.reorder(recordId, uploaded[2]!.id, 0, owner);
  assert.equal(movedUp.sortOrder, 0);
  let rows = await activePhotos(recordId);
  assert.deepEqual(
    rows.map((row) => row.id),
    [uploaded[2]!.id, uploaded[0]!.id],
  );
  assertContiguous(rows);

  const movedDown = await repairPhotoService.reorder(recordId, uploaded[2]!.id, 1, owner);
  assert.equal(movedDown.sortOrder, 1);
  rows = await activePhotos(recordId);
  assert.deepEqual(
    rows.map((row) => row.id),
    [uploaded[0]!.id, uploaded[2]!.id],
  );
  assertContiguous(rows);

  const detail = await repairQueryService.getById(recordId, owner);
  assert.deepEqual(
    detail.photos.map((photo) => photo.id),
    [uploaded[0]!.id, uploaded[2]!.id],
  );
});

dbTest("历史空洞 / 重复序号在下一次写操作后收敛（issue #235）", async () => {
  const member = await createMember("序号收敛");
  const owner = ownerActor(member);
  const recordId = await createPendingRecord(member.profileId);
  const uploaded = await repairPhotoService.upload(
    recordId,
    [pngFile("a.png"), pngFile("b.png")],
    owner,
  );

  // 模拟旧数据留下的空洞：[0, 2]
  await getDb().repairPhoto.update({
    where: { id: uploaded[1]!.id },
    data: { sortOrder: 2 },
  });
  const appended = await repairPhotoService.upload(recordId, [pngFile("c.png")], owner);
  assert.equal(appended[0]!.sortOrder, 2);
  let rows = await activePhotos(recordId);
  assert.deepEqual(
    rows.map((row) => row.id),
    [uploaded[0]!.id, uploaded[1]!.id, appended[0]!.id],
  );
  assertContiguous(rows);

  // 模拟重复序号：前两张都是 0；固定 createdAt 让重复项之间的顺序可预期。
  const first = rows[0]!;
  const second = rows[1]!;
  const third = rows[2]!;
  await getDb().repairPhoto.update({ where: { id: first.id }, data: { sortOrder: 0 } });
  await getDb().repairPhoto.update({ where: { id: second.id }, data: { sortOrder: 0 } });
  await getDb().repairPhoto.update({
    where: { id: first.id },
    data: { createdAt: new Date("2026-10-01T00:00:00.000Z") },
  });
  await getDb().repairPhoto.update({
    where: { id: second.id },
    data: { createdAt: new Date("2026-10-01T00:00:01.000Z") },
  });

  const moved = await repairPhotoService.reorder(recordId, third.id, 0, owner);
  assert.equal(moved.sortOrder, 0);
  rows = await activePhotos(recordId);
  assert.deepEqual(
    rows.map((row) => row.id),
    [third.id, first.id, second.id],
  );
  assertContiguous(rows);
});

dbTest("审核通过关闭补传窗口；退回后恢复", async () => {
  const member = await createMember("审核窗口");
  const owner = ownerActor(member);
  const admin = await createAdmin();
  const recordA = await createPendingRecord(member.profileId);

  const adminDetail = await repairQueryService.getById(recordA, admin.actor);
  assert.equal(adminDetail.canAttachPhotos, false, "管理员不代传");
  const photo = await repairPhotoService.upload(recordA, [pngFile("before.png")], owner);

  await repairReviewService.review(
    recordA,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    admin.actor,
  );
  assert.equal((await repairQueryService.getById(recordA, owner)).canAttachPhotos, false);
  await assert.rejects(
    () => repairPhotoService.upload(recordA, [pngFile("after.png")], owner),
    rejectsWith("REPAIR_STATE_INVALID"),
  );
  await assert.rejects(
    () => repairPhotoService.remove(recordA, photo[0]!.id, owner),
    rejectsWith("REPAIR_STATE_INVALID"),
  );
  await assert.rejects(
    () => repairPhotoService.reorder(recordA, photo[0]!.id, 0, owner),
    rejectsWith("REPAIR_STATE_INVALID"),
  );

  const recordB = await createPendingRecord(member.profileId);
  await repairReviewService.review(
    recordB,
    { decision: "REJECTED", note: "补充照片", idempotencyKey: randomUUID() },
    admin.actor,
  );
  assert.equal((await repairQueryService.getById(recordB, owner)).canAttachPhotos, true);
  const afterReject = await repairPhotoService.upload(recordB, [pngFile("rejected.png")], owner);
  assert.equal(afterReject.length, 1);
});

dbTest("非本人 / 管理员不代传；软删除记录拒绝", async () => {
  const member = await createMember("权限边界");
  const other = await createMember("其他成员");
  const admin = await createAdmin();
  const recordId = await createPendingRecord(member.profileId);

  await assert.rejects(
    () => repairPhotoService.upload(recordId, [pngFile("other.png")], ownerActor(other)),
    rejectsWith("REPAIR_FORBIDDEN"),
  );
  await assert.rejects(
    () => repairPhotoService.upload(recordId, [pngFile("admin.png")], admin.actor),
    rejectsWith("REPAIR_FORBIDDEN"),
  );

  await repairService.softDelete(recordId, "照片权限测试", admin.actor);
  await assert.rejects(
    () => repairPhotoService.upload(recordId, [pngFile("deleted.png")], ownerActor(member)),
    rejectsWith("REPAIR_NOT_FOUND"),
  );
});

dbTest("并发审核：文件存储期间审核完成，补传整体失败并清理文件", async () => {
  const member = await createMember("并发审核");
  const owner = ownerActor(member);
  const admin = await createAdmin();
  const recordId = await createPendingRecord(member.profileId);

  let markPutStarted!: () => void;
  const putStarted = new Promise<void>((resolve) => {
    markPutStarted = resolve;
  });
  let releasePut!: () => void;
  const release = new Promise<void>((resolve) => {
    releasePut = resolve;
  });
  const deletedKeys: string[] = [];
  let putCount = 0;
  const service = createRepairPhotoService({
    async put() {
      markPutStarted();
      await release;
      putCount += 1;
      return { storageKey: `repairs/race/photo-${putCount}.png` };
    },
    async open() {
      return new Uint8Array();
    },
    async delete(key) {
      deletedKeys.push(key);
    },
  });

  const upload = service.upload(recordId, [pngFile("race.png")], owner);
  await putStarted;
  await repairReviewService.review(
    recordId,
    { decision: "APPROVED", idempotencyKey: randomUUID() },
    admin.actor,
  );
  releasePut();

  await assert.rejects(upload, rejectsWith("REPAIR_STATE_INVALID"));
  assert.deepEqual(deletedKeys, ["repairs/race/photo-1.png", "repairs/race/photo-2.png"]);
  assert.equal(
    await getDb().repairPhoto.count({ where: { repairRecordId: recordId, deletedAt: null } }),
    0,
  );
});
