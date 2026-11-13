import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * 无障碍基线：只记录 impact 为 critical / serious 的规则 id，按路由对比。
 *
 * 目标不是「零问题」（历史页面已有一批对比度等问题），而是**不新增**：
 * 修复规则后旧 id 可以留在基线里，下次重录时清掉。
 * 节点数量会随内容变化，因此只比较规则 id。
 */
const BASELINE_PATH = resolve("tests/e2e/axe-baseline.json");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type Baseline = {
  recordedAt: string;
  tool: string;
  routes: Record<string, string[]>;
};

function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return {
      recordedAt: new Date().toISOString().slice(0, 10),
      tool: "axe-core（wcag2a / wcag2aa / wcag21a / wcag21aa）",
      routes: {},
    };
  }
}

export async function scanA11y(page: Page, route: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const found = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  const ids = [...new Set(found.map((violation) => violation.id))].sort();

  if (process.env.AXE_UPDATE_BASELINE === "1") {
    const baseline = readBaseline();
    baseline.routes[route] = ids;
    baseline.recordedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    return;
  }

  const known = new Set(readBaseline().routes[route] ?? []);
  const added = found.filter((violation) => !known.has(violation.id));
  const details = added
    .map(
      (violation) =>
        `- ${violation.id} [${violation.impact}] ${violation.help}\n  ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join("\n  ")}`,
    )
    .join("\n");
  expect(
    added.map((violation) => violation.id),
    `路由 ${route} 出现新的 critical/serious 无障碍问题：\n${details}`,
  ).toEqual([]);
}
