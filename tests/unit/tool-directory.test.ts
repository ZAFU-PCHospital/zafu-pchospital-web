import assert from "node:assert/strict";
import test from "node:test";

import { toolCategories } from "../../src/config/tools";
import { toolRepository } from "../../src/features/tools/tool-repository";
import { toolService } from "../../src/features/tools/tool-service";

const site = {
  id: "site",
  categoryId: "category",
  name: "网站",
  url: "https://example.com/",
  description: null,
  sortOrder: 0,
  isActive: true,
};
const category = {
  id: "category",
  code: "CATEGORY",
  name: "分类",
  labelEn: null,
  description: null,
  sortOrder: 0,
  isActive: true,
};

test("工具目录在两张表都为空时显示内置清单", async (t) => {
  t.mock.method(toolRepository, "listCategories", async () => []);
  t.mock.method(toolRepository, "listSites", async () => []);
  t.mock.method(toolRepository, "hasRecords", async () => false);

  const groups = await toolService.listPublicGroups();
  assert.equal(groups.length, toolCategories.length);
  assert.equal(groups.flatMap((group) => group.sites).length, 31);
});

test("全部分类停用时目录保持为空", async (t) => {
  t.mock.method(
    toolRepository,
    "listCategories",
    async ({ activeOnly }: { activeOnly: boolean }) =>
      activeOnly ? [] : [{ ...category, isActive: false }],
  );
  t.mock.method(toolRepository, "listSites", async () => [site]);

  assert.deepEqual(await toolService.listPublicGroups(), []);
});

test("全部网站软删除时目录保持为空", async (t) => {
  t.mock.method(toolRepository, "listCategories", async () => [category]);
  t.mock.method(toolRepository, "listSites", async () => []);

  assert.deepEqual(await toolService.listPublicGroups(), []);
});

test("只剩历史行时目录保持为空", async (t) => {
  t.mock.method(toolRepository, "listCategories", async () => []);
  t.mock.method(toolRepository, "listSites", async () => []);
  t.mock.method(toolRepository, "hasRecords", async () => true);

  assert.deepEqual(await toolService.listPublicGroups(), []);
});

test("工具目录读取失败时记录分类信息并回退到内置清单", async (t) => {
  t.mock.method(toolRepository, "listPublicGroups", async () => {
    throw Object.assign(new Error("connection details"), { code: "P1001" });
  });
  const warn = t.mock.method(console, "warn", () => {});

  assert.equal((await toolService.listPublicGroups()).length, toolCategories.length);
  assert.deepEqual(warn.mock.calls[0]?.arguments[1], { code: "P1001", type: "Error" });
});
