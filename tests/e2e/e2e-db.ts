import { randomBytes, randomInt, randomUUID, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../../src/generated/prisma/client";
import { assertTestDatabase } from "../integration/db-guard";
import type { E2ESeed } from "./types";

/**
 * E2E 夹具的唯一写入口，由 `globalSetup` 通过 tsx 启动。
 *
 * 为什么不直接在 Playwright 里 import Prisma：生成的客户端是 ESM（用到
 * `import.meta.url`），而本仓库 `package.json` 不是 `"type": "module"`，
 * Playwright 会把测试转成 CJS，加载生成客户端时会报语法错误。放进独立 tsx
 * 进程既绕开这个限制，也让写库 / 清库与浏览器进程隔离。
 *
 * 数据全部带本次运行的随机前缀，只动测试库；`assertTestDatabase()` 在写库前拦住
 * 指向开发库的误操作。角色按 code upsert，不依赖 `pnpm db:seed`。
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少 DATABASE_URL：请指向独立测试库");
assertTestDatabase();

const seedFile = resolve(process.env.E2E_SEED_FILE ?? "tests/e2e/.artifacts/seed.json");

const url = new URL(databaseUrl);
const db = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 3,
    allowPublicKeyRetrieval: url.searchParams.get("allowPublicKeyRetrieval") === "true",
    timezone: "Z",
    charset: "utf8mb4",
  }),
});

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function uniqueQq(): string {
  return String(9000000000 + randomInt(0, 899_999_999));
}

function uniquePhone(): string {
  return `139${String(randomInt(0, 99_999_999)).padStart(8, "0")}`;
}

async function ensureRole(code: "ADMIN" | "MEMBER", name: string) {
  return db.role.upsert({
    where: { code },
    update: { name },
    create: { id: randomUUID(), code, name, createdAt: new Date() },
  });
}

async function seed(): Promise<void> {
  const now = new Date();
  const runId = randomBytes(4).toString("hex");
  const password = `E2e-${runId}-pass`;
  const adminQq = uniqueQq();
  let memberQq = uniqueQq();
  while (memberQq === adminQq) memberQq = uniqueQq();
  const adminRole = await ensureRole("ADMIN", "管理员");
  const memberRole = await ensureRole("MEMBER", "成员");

  const adminId = randomUUID();
  const memberId = randomUUID();
  const memberProfileId = randomUUID();

  await db.user.create({
    data: {
      id: adminId,
      status: "ACTIVE",
      displayName: `E2E 管理员 ${runId}`,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.userIdentity.create({
    data: {
      id: randomUUID(),
      userId: adminId,
      type: "QQ",
      identifierNormalized: adminQq,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.passwordCredential.create({
    data: {
      userId: adminId,
      passwordHash: hashPassword(password),
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId: adminId,
      roleId: adminRole.id,
      sourceType: "ADMIN_CREATED",
      sourceId: adminId,
      grantedAt: now,
      activeKey: `${adminId}:${adminRole.id}`,
    },
  });

  await db.user.create({
    data: {
      id: memberId,
      status: "ACTIVE",
      displayName: `E2E 报名成员 ${runId}`,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.userIdentity.create({
    data: {
      id: randomUUID(),
      userId: memberId,
      type: "QQ",
      identifierNormalized: memberQq,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.passwordCredential.create({
    data: {
      userId: memberId,
      passwordHash: hashPassword(password),
      mustChangePassword: false,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.userRole.create({
    data: {
      id: randomUUID(),
      userId: memberId,
      roleId: memberRole.id,
      sourceType: "ADMIN_CREATED",
      sourceId: adminId,
      grantedAt: now,
      activeKey: `${memberId}:${memberRole.id}`,
    },
  });
  await db.memberProfile.create({
    data: {
      id: memberProfileId,
      userId: memberId,
      realName: `E2E报名成员${runId}`,
      department: "REPAIR",
      studentId: `E2E-${runId}`,
      className: "E2E 测试班",
      status: "ACTIVE",
      version: 1,
      sortOrder: 0,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  const listPrefix = `E2E列表${runId}-`;
  const listUsers = Array.from({ length: 21 }, (_, index) => {
    const id = randomUUID();
    return {
      id,
      status: "ACTIVE",
      displayName: `${listPrefix}${String(index + 1).padStart(2, "0")}`,
      createdAt: new Date(now.getTime() - index * 60_000),
      updatedAt: new Date(now.getTime() - index * 60_000),
    };
  });
  await db.user.createMany({ data: listUsers });
  await db.memberProfile.createMany({
    data: listUsers.map((user, index) => ({
      id: randomUUID(),
      userId: user.id,
      realName: `${listPrefix}${String(index + 1).padStart(2, "0")}`,
      department: "REPAIR",
      studentId: `E2E-L-${runId}-${index + 1}`,
      status: "ACTIVE",
      version: 1,
      sortOrder: index,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  });

  const activityId = randomUUID();
  const activityAt = new Date(now.getTime() + 20 * 60_000);
  const title = `E2E 巡检活动 ${runId}`;
  await db.repairActivity.create({
    data: {
      id: activityId,
      version: 1,
      title,
      location: "E2E 测试地点",
      activityAt,
      endsAt: new Date(activityAt.getTime() + 3 * 60 * 60_000),
      capacity: 20,
      signupOpensAt: new Date(now.getTime() - 60 * 60_000),
      signupClosesAt: new Date(activityAt.getTime() - 5 * 60_000),
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    },
  });

  const seed: E2ESeed = {
    runId,
    admin: { userId: adminId, qq: adminQq, password },
    member: { userId: memberId, profileId: memberProfileId, qq: memberQq, password },
    activity: { id: activityId, title },
    customer: { name: `E2E客户${runId}`, phone: uniquePhone() },
    listPrefix,
  };
  mkdirSync(dirname(seedFile), { recursive: true });
  writeFileSync(seedFile, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  console.log(
    `[e2e] 已写入夹具：活动 ${activityId}，管理员 ${adminQq}，成员 ${memberQq}，列表前缀 ${listPrefix}`,
  );
}

async function cleanup(): Promise<void> {
  let seed: E2ESeed;
  try {
    seed = JSON.parse(readFileSync(seedFile, "utf8")) as E2ESeed;
  } catch {
    console.warn("[e2e] 没有找到夹具清单，跳过清理");
    return;
  }
  const userIds = [seed.admin.userId, seed.member.userId];
  const listUsers = await db.user.findMany({
    where: { displayName: { startsWith: seed.listPrefix } },
    select: { id: true },
  });
  userIds.push(...listUsers.map((row) => row.id));
  const registrations = await db.repairActivityRegistration.findMany({
    where: { activityId: seed.activity.id },
    select: { id: true },
  });
  const registrationIds = registrations.map((row) => row.id);
  const attendances = await db.repairActivityAttendance.findMany({
    where: { activityId: seed.activity.id },
    select: { id: true },
  });
  const targetIds = [seed.activity.id, ...registrationIds, ...attendances.map((row) => row.id)];

  await db.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: targetIds } }] },
  });
  await db.repairActivityNoShowEvent.deleteMany({ where: { activityId: seed.activity.id } });
  await db.repairActivityAttendance.deleteMany({ where: { activityId: seed.activity.id } });
  await db.repairActivityRegistration.deleteMany({ where: { activityId: seed.activity.id } });
  await db.repairActivity.deleteMany({ where: { id: seed.activity.id } });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordCredential.deleteMany({ where: { userId: { in: userIds } } });
  await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await db.memberProfile.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  console.log("[e2e] 已清理夹具");
}

async function main(): Promise<void> {
  try {
    if (process.env.E2E_MODE === "cleanup") await cleanup();
    else await seed();
  } finally {
    await db.$disconnect();
  }
}

void main();
