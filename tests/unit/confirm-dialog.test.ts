import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { ReactNode } from "react";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const ReactDOM = require("react-dom") as typeof import("react-dom");
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
// ConfirmDialog 依赖的 Icon 在模块顶层就有 JSX，需先挂上全局 React 再 require。
(globalThis as unknown as { React: typeof React }).React = React;
const { ConfirmDialog } = require("../../src/components/ui/ConfirmDialog") as typeof import("../../src/components/ui/ConfirmDialog");

/**
 * ConfirmDialog 只在浏览器里渲染（`typeof document === "undefined"` 时返回 null）并 Portal 到 body。
 * 这里给一个最小 document、把 Portal 换成直出，才能断言 props → DOM 的映射本身。
 */
function render(props: Parameters<typeof ConfirmDialog>[0]): string {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalCreatePortal = ReactDOM.createPortal;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: {} } });
  (ReactDOM as unknown as { createPortal: unknown }).createPortal = (children: ReactNode) =>
    React.createElement(React.Fragment, null, children);
  try {
    // 交给渲染器调用组件：hooks（useId/useRef/useEffect）需要渲染上下文。
    return renderToStaticMarkup(React.createElement(ConfirmDialog, props));
  } finally {
    (ReactDOM as unknown as { createPortal: unknown }).createPortal = originalCreatePortal;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

const base = {
  title: "报名成功",
  children: React.createElement("p", null, "凭条内容"),
  onConfirm: () => {},
  onClose: () => {},
};

test("confirmLabel 为 null 时不渲染动作行与确认按钮，只留关闭", () => {
  const html = render({ ...base, confirmLabel: null });
  assert.equal(html.includes("signup__actions"), false, "动作行不应出现");
  assert.equal(html.includes("<button"), true, "标题栏关闭按钮仍应存在");
  assert.ok(html.includes("关闭"), "关闭按钮可访问名保留");
  assert.ok(html.includes("凭条内容"), "正文照常渲染");
});

test("confirmLabel 与 cancelLabel 都为空时同样没有动作行", () => {
  const html = render({ ...base, confirmLabel: null, cancelLabel: undefined });
  assert.equal(html.includes("signup__actions"), false);
});

test("传字符串 confirmLabel 时动作行与按钮照旧渲染（既有调用点行为不变）", () => {
  const html = render({ ...base, confirmLabel: "确认删除", cancelLabel: "取消" });
  assert.equal(html.includes("signup__actions"), true);
  assert.ok(html.includes("确认删除"));
  assert.ok(html.includes("取消"));
});

test("size 与 titleTone 只在与默认值不同时加类", () => {
  const plain = render({ ...base, confirmLabel: "确定" });
  assert.equal(plain.includes("admin-modal__window--narrow"), false);
  assert.equal(plain.includes("admin-modal__title--success"), false);

  const narrow = render({
    ...base,
    confirmLabel: null,
    size: "narrow",
    titleTone: "success",
  });
  assert.ok(narrow.includes("admin-modal__window--narrow"), "窄档类生效");
  assert.ok(narrow.includes("admin-modal__title--success"), "成功色标题类生效");
  assert.ok(narrow.includes('role="dialog"'));
  assert.ok(narrow.includes('aria-modal="true"'));
});

test("layout=fit 时动作区渲染到独立 footer，正文里不再有动作行", () => {
  const fit = render({ ...base, confirmLabel: "关闭", layout: "fit" });
  assert.ok(fit.includes("admin-modal__window--fit"), "fit 窗口类生效");
  assert.ok(fit.includes("admin-modal__footer"), "底部动作区固定在 footer");
  assert.equal(
    (fit.match(/signup__actions/g) ?? []).length,
    1,
    "动作行只出现一次（footer 内），正文不重复",
  );
  assert.ok(fit.includes("关闭"));
});

test("titleHidden 时标题带仅读屏可见类，仍保留 aria-labelledby 目标", () => {
  const html = render({ ...base, confirmLabel: "关闭", titleHidden: true });
  assert.ok(html.includes("admin-modal__title--visually-hidden"), "视觉隐藏类生效");
  const titleId = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
  assert.ok(titleId, "对话框仍有 aria-labelledby");
  assert.ok(html.includes(`id="${titleId}"`), "aria-labelledby 指向的标题仍在 DOM");
});

test("closeIconOnly 时 ✕ 为纯图标按钮且带可访问名", () => {
  const html = render({ ...base, confirmLabel: "关闭", closeIconOnly: true });
  assert.ok(html.includes('aria-label="关闭"'), "✕ 有可访问名");
  assert.ok(html.includes("admin-modal__close-icon"), "纯图标按钮类生效");
  assert.equal(
    (html.match(/<span>关闭<\/span>/g) ?? []).length,
    1,
    "只有底部按钮渲染文字，✕ 不带文字节点",
  );
});
