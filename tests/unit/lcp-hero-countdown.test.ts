import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("首屏标题首帧可见：不再从 105% 起步，也不排队等 delay（issue #379）", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf(".hero__title .hl__in {");
  assert.ok(start >= 0, "缺少 .hero__title .hl__in");
  const rule = css.slice(start, css.indexOf("}", start));

  // 首帧不可见（translateY(105%)）会让 LCP 等动画播完，必须去掉。
  assert.equal(rule.includes("translateY(105%)"), false);
  assert.ok(rule.includes("translateY(0.14em)"), "改为轻微归位");
  assert.ok(rule.includes("520ms"), "时长落在 450–600ms");
  assert.ok(rule.includes("--ease-expo"), "沿用品牌曲线");
  // 入场 delay 必须消失：不允许「先等再出现」。
  assert.equal(rule.includes("animation-delay"), false);
});

test("折叠线以上不走进场揭示：hero 文案、按钮、读数面板首帧可见（issue #379）", () => {
  const hero = read("src/components/home/Hero.tsx");
  // hero 内不再有 Reveal 包裹。
  assert.equal(hero.includes("<Reveal"), false);
  assert.equal(hero.includes("@/components/ui/Reveal"), false);
  assert.ok(hero.includes('<p className="hero__lead">'));
  assert.ok(hero.includes('<div className="hero__actions">'));
  // 读数面板显式关闭揭示。
  assert.ok(hero.includes("reveal={false}"));

  // Readout 默认仍走揭示，只有调用方显式关闭时才不加 `.reveal`。
  const readout = read("src/components/ui/Readout.tsx");
  assert.ok(readout.includes("reveal = true"));
  assert.ok(readout.includes('cn("readout", reveal && "reveal", className)'));
});

test("倒计时叶子化：父级不再每秒 setState，tick 只在 ActivityCountdown（issue #379）", () => {
  const detail = read("src/components/repair-activities/RepairActivityDetail.tsx");
  const leaf = read("src/components/repair-activities/ActivityCountdown.tsx");

  // 父级不得再有 1 秒间隔（30 秒轮询与边界定时器不受影响）。
  assert.equal(/setInterval\([^)]*,\s*1_?000\)/.test(detail), false, "父级不应有 1 秒 tick");
  assert.ok(detail.includes("<ActivityCountdown"), "父级改用叶子组件");

  // 叶子自持 1 秒 tick，并沿用 serverOffsetMs 校正与纯函数格式化。
  assert.ok(leaf.includes("setInterval(() => setNowMs(Date.now()), 1000)"));
  assert.ok(leaf.includes("serverOffsetMs"));
  assert.ok(leaf.includes("signupCountdownParts"));
  // 数字块仍不进 live region：叶子只有 role="timer"，不引入 aria-live。
  assert.ok(leaf.includes('role="timer"'));
  assert.equal(/aria-live=/.test(leaf), false);
});
