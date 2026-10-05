import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { resolveDocsSourceRoot } from "../../tools/docs-source.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = resolveDocsSourceRoot(projectRoot);
const themeScript = readFileSync(path.join(sourceRoot, "theme/pc-hospital.js"), "utf8");

function themeRuntime(hosted: boolean) {
  const storage = new Map<string, string>();
  const buttons = new Map<string, { textContent: string }>();
  let onClick: (event: unknown) => void = () => {};
  const meta = {
    content: "",
    setAttribute: (_name: string, value: string) => (meta.content = value),
  };
  runInNewContext(themeScript, {
    document: {
      documentElement: {},
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? meta : hosted ? {} : null,
      getElementById: (id: string) => {
        const button = { textContent: "" };
        buttons.set(id, button);
        return button;
      },
      addEventListener: (_type: string, listener: typeof onClick) => (onClick = listener),
    },
    localStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    getComputedStyle: () => ({ getPropertyValue: () => "oklch(14.5% 0.006 95)" }),
    MutationObserver: class {
      observe() {}
    },
  });
  return {
    storage,
    buttons,
    meta,
    click: (id: string) => onClick({ target: { closest: () => ({ id }) } }),
  };
}

test("独立文档切换主题不修改官网偏好，主题名称和地址栏配色正确", () => {
  const runtime = themeRuntime(false);
  runtime.storage.set("zafu-pchospital:theme-mode", "normal");
  runtime.click("mdbook-theme-coal");
  assert.equal(runtime.storage.get("zafu-pchospital:theme-mode"), "normal");
  assert.equal(runtime.buttons.get("mdbook-theme-coal")?.textContent, "深色");
  assert.equal(runtime.meta.content, "oklch(14.5% 0.006 95)");
});

test("官网内文档切换深浅色同步官网，自动模式清除显式选择", () => {
  const runtime = themeRuntime(true);
  runtime.click("mdbook-theme-coal");
  assert.equal(runtime.storage.get("zafu-pchospital:theme-mode"), "dark");
  runtime.click("mdbook-theme-light");
  assert.equal(runtime.storage.get("zafu-pchospital:theme-mode"), "normal");
  runtime.click("mdbook-theme-default_theme");
  assert.equal(runtime.storage.has("zafu-pchospital:theme-mode"), false);
});

test("调色板检查读取指定文档版本，阻止颜色漂移与默认深色配置漂移", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "zafu-pchospital-theme-test-"));
  try {
    cpSync(path.join(sourceRoot, "theme"), path.join(fixture, "theme"), { recursive: true });
    const config = readFileSync(path.join(sourceRoot, "book.toml"), "utf8");
    writeFileSync(path.join(fixture, "book.toml"), config);
    const check = () =>
      spawnSync(process.execPath, ["tools/check-theme-palette.mjs"], {
        cwd: projectRoot,
        env: { ...process.env, DOCS_SOURCE_DIR: fixture },
        encoding: "utf8",
      });
    assert.equal(check().status, 0);
    const cssPath = path.join(fixture, "theme/pc-hospital.css");
    const css = readFileSync(cssPath, "utf8");
    writeFileSync(cssPath, css.replace("--pc-accent: #2457ff", "--pc-accent: #000000"));
    const paletteDrift = check();
    assert.equal(paletteDrift.status, 1);
    assert.match(paletteDrift.stderr, /--accent 取值不一致/);
    writeFileSync(cssPath, css);
    writeFileSync(
      path.join(fixture, "book.toml"),
      config.replace('preferred-dark-theme = "coal"', 'preferred-dark-theme = "navy"'),
    );
    const configDrift = check();
    assert.equal(configDrift.status, 1);
    assert.match(configDrift.stderr, /preferred-dark-theme 必须为 "coal"/);
  } finally {
    // mkdtemp 创建的精确目录，不接收用户输入路径。
    rmSync(fixture, { recursive: true, force: true });
  }
});
