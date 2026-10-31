import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { POST } from "../../src/app/api/v1/auth/logout/route";
import { authService } from "../../src/features/auth/auth-service";
import { authenticateRequest } from "../../src/lib/auth/request";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import { resetServerEnvForTests } from "../../src/lib/env";
import { digestSessionToken } from "../../src/lib/security/secrets";
import { integrationTestsEnabled } from "./db-guard";
import { sameOriginHeaders } from "./http-harness";

const enabled = integrationTestsEnabled();
const dbTest = enabled ? test : test.skip;
const userId = randomUUID();

before(async () => {
  if (!enabled) return;
  const now = new Date();
  await getDb().user.create({
    data: {
      id: userId,
      status: "ACTIVE",
      displayName: "退出回归夹具",
      createdAt: now,
      passwordCredential: {
        create: {
          passwordHash: "unused-logout-fixture",
          mustChangePassword: true,
          createdAt: now,
        },
      },
    },
  });
});

after(async () => {
  if (!enabled) return;
  const db = getDb();
  await db.auditLog.deleteMany({ where: { actorUserId: userId } });
  await db.authSession.deleteMany({ where: { userId } });
  await db.passwordCredential.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await disconnectDb();
});

async function session() {
  const token = randomUUID();
  const now = new Date();
  const row = await getDb().authSession.create({
    data: {
      id: randomUUID(),
      userId,
      tokenDigest: digestSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });
  return { token, id: row.id };
}

function request(token = "", origin = true) {
  return new Request("http://localhost/api/v1/auth/logout", {
    method: "POST",
    headers: {
      ...(origin ? sameOriginHeaders() : { origin: "https://other.example" }),
      cookie: `pc_hospital_session=${token}`,
    },
  });
}

async function auditActions(id: string) {
  return (
    await getDb().auditLog.findMany({ where: { targetId: id }, orderBy: { action: "asc" } })
  ).map((row) => row.action);
}

dbTest("退出撤销 Session、清 Cookie 并写两条审计；重复退出不重复写入", async () => {
  const { token, id } = await session();
  const response = await POST(request(token));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.loggedOut, true);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.ok((await getDb().authSession.findUniqueOrThrow({ where: { id } })).revokedAt);
  assert.deepEqual(await auditActions(id), ["auth.logout", "auth.session.revoked"]);
  await assert.rejects(authService.authenticate(token), { code: "AUTH_SESSION_INVALID" });
  assert.equal((await POST(request(token))).status, 200);
  assert.deepEqual(await auditActions(id), ["auth.logout", "auth.session.revoked"]);
});

dbTest("并发退出同一 Session 只撤销一次并写一组审计", async () => {
  const { token, id } = await session();
  const db = getDb();
  let reads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrentDb = db.$extends({
    query: {
      authSession: {
        async findUnique({ args, query }) {
          const result = await query(args);
          if (result?.id === id && ++reads <= 2) {
            if (reads === 2) release();
            await bothRead;
          }
          return result;
        },
      },
    },
  });
  const dbGlobal = globalThis as typeof globalThis & { __pcHospitalDb?: typeof db };
  dbGlobal.__pcHospitalDb = concurrentDb as unknown as typeof db;
  try {
    const responses = await Promise.all([POST(request(token)), POST(request(token))]);
    assert.equal(reads, 2);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200],
    );
    assert.ok((await db.authSession.findUniqueOrThrow({ where: { id } })).revokedAt);
    assert.deepEqual(await auditActions(id), ["auth.logout", "auth.session.revoked"]);
  } finally {
    dbGlobal.__pcHospitalDb = db;
  }
});

dbTest("无 Cookie 或未知 Session 幂等成功并清 Cookie", async () => {
  for (const token of ["", randomUUID()]) {
    const response = await POST(request(token));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.loggedOut, true);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  }
});

dbTest("来源校验失败不撤销 Session、不清 Cookie、不写审计", async () => {
  const { token, id } = await session();
  const response = await POST(request(token, false));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await getDb().authSession.findUniqueOrThrow({ where: { id } })).revokedAt, null);
  assert.deepEqual(await auditActions(id), []);
});

dbTest("审计写入失败回滚撤销，可用原令牌重试", async () => {
  const { token, id } = await session();
  const db = getDb();
  // 只在数据库写入边界注入故障，事务和回滚仍由真实 GreatSQL 执行。
  let writes = 0;
  const faultDb = db.$extends({
    query: {
      auditLog: {
        create({ args, query }) {
          if (++writes === 2) throw new Error("audit storage unavailable");
          return query(args);
        },
      },
    },
  });
  const dbGlobal = globalThis as typeof globalThis & { __pcHospitalDb?: typeof db };
  dbGlobal.__pcHospitalDb = faultDb as unknown as typeof db;
  try {
    const response = await POST(request(token));
    assert.equal(response.status, 500);
    assert.equal((await response.json()).success, false);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await db.authSession.findUniqueOrThrow({ where: { id } })).revokedAt, null);
    assert.deepEqual(await auditActions(id), []);
    assert.equal((await authService.authenticate(token)).userId, userId);
  } finally {
    dbGlobal.__pcHospitalDb = db;
  }
  assert.equal((await POST(request(token))).status, 200);
  assert.ok((await db.authSession.findUniqueOrThrow({ where: { id } })).revokedAt);
  assert.deepEqual(await auditActions(id), ["auth.logout", "auth.session.revoked"]);
});

dbTest("强制改密或邮箱门禁中的 Session 仍可退出", async () => {
  const previous = process.env.EMAIL_GATE_MODE;
  process.env.EMAIL_GATE_MODE = "all";
  resetServerEnvForTests();
  try {
    for (const mustChangePassword of [true, false]) {
      await getDb().passwordCredential.update({ where: { userId }, data: { mustChangePassword } });
      const { token, id } = await session();
      await assert.rejects(authenticateRequest(request(token), "req_logout_gate"), {
        code: mustChangePassword ? "PASSWORD_CHANGE_REQUIRED" : "EMAIL_VERIFICATION_REQUIRED",
      });
      const response = await POST(request(token));
      assert.equal(response.status, 200);
      assert.ok((await getDb().authSession.findUniqueOrThrow({ where: { id } })).revokedAt);
    }
  } finally {
    if (previous === undefined) delete process.env.EMAIL_GATE_MODE;
    else process.env.EMAIL_GATE_MODE = previous;
    resetServerEnvForTests();
  }
});
