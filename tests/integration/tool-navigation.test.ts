import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { GET as listCategories } from "../../src/app/api/v1/admin/tools/categories/route";
import { POST as moveSite } from "../../src/app/api/v1/admin/tools/sites/[id]/move/route";
import { GET as listSites, POST as createSite } from "../../src/app/api/v1/admin/tools/sites/route";
import {
  toolCategoryAdminService as categories,
  toolSiteAdminService as sites,
} from "../../src/features/tools/tool-admin-service";
import { toolService } from "../../src/features/tools/tool-service";
import { disconnectDb, getDb } from "../../src/lib/db/client";
import type { AuthorizedActor } from "../../src/types/contracts";
import { integrationTestsEnabled } from "./db-guard";
import { callRoute, sessionCookie } from "./http-harness";

const run = integrationTestsEnabled();
const categoryUrl = "http://localhost/api/v1/admin/tools/categories";
const siteUrl = "http://localhost/api/v1/admin/tools/sites";

if (run) after(disconnectDb);

test("工具导航的权限、并发去重、排序和软删除", { skip: !run }, async (t) => {
  const db = getDb();
  const userId = randomUUID();
  const actor: AuthorizedActor = {
    actorType: "USER",
    userId,
    userStatus: "ACTIVE",
    permissions: ["tool:manage"],
    requestId: randomUUID(),
  };
  await db.user.create({ data: { id: userId, status: "ACTIVE", createdAt: new Date() } });
  t.after(async () => {
    await db.auditLog.deleteMany({ where: { actorUserId: userId } });
    await db.toolSite.deleteMany({ where: { createdBy: userId } });
    await db.toolCategory.deleteMany({ where: { createdBy: userId } });
    await db.authSession.deleteMany({ where: { userId } });
    await db.userRole.deleteMany({ where: { userId } });
    await db.passwordCredential.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  });
  const cookie = await sessionCookie(userId);
  const headers = { cookie };
  assert.equal((await callRoute(listSites, siteUrl)).status, 401);
  assert.equal((await callRoute(listCategories, categoryUrl, { headers })).status, 200);
  assert.equal((await callRoute(listSites, siteUrl, { headers })).status, 200);
  await assert.rejects(sites.list({ ...actor, permissions: [] }), { status: 403 });
  assert.equal(
    (
      await callRoute(createSite, siteUrl, {
        method: "POST",
        headers: { cookie, origin: "https://other.example" },
        body: {},
      })
    ).status,
    403,
  );

  const prefix = `工具集成 ${userId.slice(0, 8)}`;
  const source = await categories.create({ name: `${prefix} 来源` }, actor);
  const target = await categories.create({ name: `${prefix} 目标` }, actor);
  await assert.rejects(categories.update(source.id, { labelEn: "x".repeat(65) }, actor), {
    code: "VALIDATION_FAILED",
  });
  await assert.rejects(categories.create({ name: prefix, description: "字".repeat(501) }, actor), {
    code: "VALIDATION_FAILED",
  });

  const href = "https://example.com/";
  const create = (url: string) =>
    callRoute(createSite, siteUrl, {
      method: "POST",
      headers,
      body: { categoryId: source.id, name: "并发网址", url },
    });
  const results = await Promise.all([create(href), create(" HTTPS://Example.COM ")]);
  assert.deepEqual(results.map((value) => value.status).sort(), [201, 409]);
  assert.equal(
    (results.find((value) => value.status === 409)?.json.error as { code: string }).code,
    "TOOL_SITE_CONFLICT",
  );
  const [first] = (await sites.list(actor)).filter((site) => site.categoryId === source.id);
  assert.equal(first.sortOrder, 0);
  await assert.rejects(categories.remove(source.id, actor), { code: "TOOL_CATEGORY_CONFLICT" });
  await sites.setActive(first.id, false, actor);
  assert.ok((await toolService.listPublicGroups()).every((group) => group.id !== source.id));
  assert.equal((await create(href)).status, 409);
  await sites.remove(first.id, actor);
  assert.ok((await toolService.listPublicGroups()).every((group) => group.id !== source.id));
  assert.equal((await create(href)).status, 201);

  const second = await sites.create(
    { categoryId: source.id, name: "第二条", url: href + "2" },
    actor,
  );
  const third = await sites.create(
    { categoryId: source.id, name: "第三条", url: href + "3" },
    actor,
  );
  const fourth = await sites.create(
    { categoryId: source.id, name: "第四条", url: href + "4" },
    actor,
  );
  const move = (beforeId: string | null) =>
    callRoute(moveSite, `${siteUrl}/${third.id}/move`, {
      method: "POST",
      headers,
      params: { id: third.id },
      body: { categoryId: target.id, beforeId },
    });
  assert.equal((await move(second.id)).status, 404);
  assert.equal(
    (await db.toolSite.findUniqueOrThrow({ where: { id: third.id } })).categoryId,
    source.id,
  );
  assert.equal((await move(null)).status, 200);
  const changed = await sites.update(second.id, { categoryId: target.id }, actor);
  assert.equal(changed.sortOrder, 1);
  assert.equal((await db.toolSite.findUniqueOrThrow({ where: { id: fourth.id } })).sortOrder, 1);
  await sites.reorder(second.id, "UP", actor);
  const inTarget = () =>
    db.toolSite.findMany({
      where: { categoryId: target.id, deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    });
  assert.deepEqual(await inTarget(), [
    { id: second.id, sortOrder: 0 },
    { id: third.id, sortOrder: 1 },
  ]);

  await sites.remove(second.id, actor);
  assert.deepEqual(await inTarget(), [{ id: third.id, sortOrder: 0 }]);
  await categories.setActive(target.id, false, actor);
  assert.ok((await toolService.listPublicGroups()).every((group) => group.id !== target.id));
  await sites.remove(third.id, actor);
  await categories.remove(target.id, actor);
  await assert.rejects(categories.create({ name: target.name }, actor), {
    code: "TOOL_CATEGORY_CONFLICT",
  });
  assert.equal(
    await db.auditLog.count({
      where: { actorUserId: userId, action: "tool_site.moved", targetId: third.id },
    }),
    1,
  );
});
