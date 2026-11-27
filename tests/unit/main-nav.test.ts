import assert from "node:assert/strict";
import test from "node:test";

import { mainNav } from "../../src/config/navigation";

/**
 * UX R3 / N1：公开 mainNav 顺序与编号写死。
 */
test("公开 mainNav 为 首页→维修活动→关于→加入→工具，编号 01–05", () => {
  assert.deepEqual(
    mainNav.map((item) => ({ index: item.index, href: item.href, label: item.label })),
    [
      { index: "01", href: "/", label: "首页" },
      { index: "02", href: "/repair-activities", label: "维修活动" },
      { index: "03", href: "/about", label: "关于我们" },
      { index: "04", href: "/join", label: "加入我们" },
      { index: "05", href: "/docs", label: "实用工具" },
    ],
  );
});
