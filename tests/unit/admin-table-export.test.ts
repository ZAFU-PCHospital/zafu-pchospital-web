import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { tableCopy } from "../../src/config/admin-tables";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");

type ExportView = ReactElement<{ children: ReactNode }>;

function downloadActions(view: ExportView) {
  const children = React.Children.toArray(view.props.children) as ReactElement<{
    onClick: () => void;
    items: { onSelect: () => void }[];
  }>[];
  return {
    desktopCsv: children[0].props.onClick,
    mobileCsv: children[2].props.items[0].onSelect,
    mobileXlsx: children[2].props.items[1].onSelect,
  };
}

test("导出计数缺失或非法时拒绝下载，不误报空结果或 NaN；真实零条仍提示空结果", async (t) => {
  (globalThis as unknown as { React: typeof React }).React = React;
  t.mock.method(React, "useState", <S>(initial: S) => [initial, () => {}]);
  t.mock.method(React, "useRef", <S>(initial: S) => ({ current: initial }));
  let response = new Response();
  t.mock.method(globalThis, "fetch", async () => response);
  const { AdminTableExport } = await import("../../src/components/admin/AdminTableExport");
  for (const rawCount of [null, "not-a-number", "0"]) {
    response = new Response("csv", {
      headers: rawCount === null ? {} : { "X-Export-Row-Count": rawCount },
    });
    let blobReads = 0;
    t.mock.method(response, "blob", async () => {
      blobReads++;
      return new Blob(["csv"]);
    });
    const errors: string[] = [];
    const successes: string[] = [];
    const view = AdminTableExport({
      path: "/export",
      params: () => new URLSearchParams(),
      disabled: false,
      onError: (message) => errors.push(message),
      onDone: (message) => successes.push(message),
    }) as ExportView;
    downloadActions(view).mobileCsv();
    await setImmediate();
    assert.equal(blobReads, 0);
    assert.deepEqual(successes, []);
    assert.equal(errors.at(-1), rawCount === "0" ? tableCopy.exportEmpty : tableCopy.exportFailed);
  }
});

test("成员导出使用已应用的完整查询，剔除分页与分组，重试时保留条件并透传错误", async (t) => {
  (globalThis as unknown as { React: typeof React }).React = React;
  t.mock.method(React, "useState", <S>(initial: S) => [initial, () => {}]);
  t.mock.method(React, "useRef", <S>(initial: S) => ({ current: initial }));
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(new URL(url, "http://localhost"));
    return new Response(JSON.stringify({ error: { message: "请缩小筛选范围" } }), { status: 409 });
  });
  const { AdminTableExport } = await import("../../src/components/admin/AdminTableExport");
  const params = new URLSearchParams({
    query: "成员姓名",
    status: "ACTIVE",
    role: "MEMBER",
    sort: "joinedAt:desc,realName:asc",
    page: "3",
    pageSize: "20",
    groupBy: "department",
  });
  params.append("filter", "department:eq:REPAIR");
  params.append("filter", "joinedAt:gte:2026-10-01");
  const errors: string[] = [];
  const view = AdminTableExport({
    path: "/api/v1/admin/members/export",
    params: () => params,
    disabled: false,
    onError: (message) => errors.push(message),
    onDone: () => assert.fail("失败响应不应报告成功"),
  }) as ExportView;
  const actions = downloadActions(view);
  actions.desktopCsv();
  actions.mobileCsv();
  await setImmediate();
  assert.equal(urls.length, 1, "在途点击不应重复请求");
  assert.equal(errors.at(-1), "请缩小筛选范围");
  actions.mobileXlsx();
  await setImmediate();
  assert.equal(urls.length, 2);
  for (const [index, url] of urls.entries()) {
    assert.equal(url.pathname, "/api/v1/admin/members/export");
    for (const key of ["page", "pageSize", "groupBy"])
      assert.equal(url.searchParams.has(key), false);
    assert.equal(url.searchParams.get("sort"), params.get("sort"));
    assert.equal(url.searchParams.get("query"), "成员姓名");
    assert.equal(url.searchParams.get("role"), "MEMBER");
    assert.equal(url.searchParams.get("status"), "ACTIVE");
    assert.deepEqual(url.searchParams.getAll("filter"), params.getAll("filter"));
    assert.equal(url.searchParams.get("format"), index === 0 ? "csv" : "xlsx");
  }
  assert.equal(params.get("page"), "3", "导出不应修改列表查询参数");
});

test("导出禁用时桌面和手机入口都不发请求", async (t) => {
  (globalThis as unknown as { React: typeof React }).React = React;
  t.mock.method(React, "useState", <S>(initial: S) => [initial, () => {}]);
  t.mock.method(React, "useRef", <S>(initial: S) => ({ current: initial }));
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("禁用时不能下载"));
  const { AdminTableExport } = await import("../../src/components/admin/AdminTableExport");
  const actions = downloadActions(
    AdminTableExport({
      path: "/export",
      params: () => new URLSearchParams(),
      disabled: true,
      onError: () => assert.fail("禁用时不应写入错误反馈"),
      onDone: () => assert.fail("禁用时不应报告成功"),
    }),
  );
  actions.desktopCsv();
  actions.mobileCsv();
  actions.mobileXlsx();
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 0);
});
