import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * 无障碍基线：按「路由 + 主题」记录 impact 为 critical / serious 的问题指纹。
 *
 * 目标不是「零问题」（历史页面已有一批对比度问题），而是**不新增**：
 * 只比较规则 id 会让「同一规则的新节点」被已有基线吞掉，因此指纹取
 * 「规则 id + 节点 target（CSS selector）」。修复后旧指纹可以留在基线里，下次重录时清掉。
 */
const BASELINE_PATH = resolve("tests/e2e/axe-baseline.json");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export const AXE_THEMES = ["normal", "dark"] as const;
export type AxeTheme = (typeof AXE_THEMES)[number];

type Fingerprint = { id: string; target: string };
type Baseline = {
  recordedAt: string;
  tool: string;
  routes: Record<string, Partial<Record<AxeTheme, Fingerprint[]>>>;
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

function fingerprintKey(fingerprint: Fingerprint): string {
  return `${fingerprint.id}\u0000${fingerprint.target}`;
}

function sortFingerprints(fingerprints: Fingerprint[]): Fingerprint[] {
  return fingerprints.sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.target !== b.target) return a.target < b.target ? -1 : 1;
    return 0;
  });
}

function targetLabel(target: unknown[]): string {
  return target
    .map((part) => {
      if (typeof part === "string") return part;
      if (Array.isArray(part)) return part.join(" ");
      return JSON.stringify(part);
    })
    .join(" ");
}

function collectFingerprints(
  violations: Array<{ id: string; nodes: Array<{ target: unknown[] }> }>,
): Fingerprint[] {
  const unique = new Map<string, Fingerprint>();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const fingerprint = { id: violation.id, target: targetLabel(node.target) };
      unique.set(fingerprintKey(fingerprint), fingerprint);
    }
  }
  return sortFingerprints([...unique.values()]);
}

export async function scanA11y(page: Page, route: string, theme: AxeTheme): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const found = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  const fingerprints = collectFingerprints(found);

  if (process.env.AXE_UPDATE_BASELINE === "1") {
    const baseline = readBaseline();
    const existing = baseline.routes[route];
    baseline.routes[route] = {
      // 兼容旧版按路由存规则数组的基线：不要把它展开成数字键。
      ...(existing && !Array.isArray(existing) ? existing : {}),
      [theme]: fingerprints,
    };
    baseline.recordedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    return;
  }

  const known = new Set(
    (readBaseline().routes[route]?.[theme] ?? []).map((fingerprint) => fingerprintKey(fingerprint)),
  );
  const added = fingerprints.filter((fingerprint) => !known.has(fingerprintKey(fingerprint)));
  const details = added
    .map((fingerprint) => `- ${fingerprint.id}  ${fingerprint.target}`)
    .join("\n");
  expect(
    added,
    `路由 ${route}（${theme}）出现新的 critical/serious 无障碍问题：\n${details}`,
  ).toEqual([]);
}
