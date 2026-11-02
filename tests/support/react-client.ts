import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { TestContext } from "node:test";
import type { ReactElement, ReactNode } from "react";

const require = createRequire(import.meta.url);
export const React = require("react") as typeof import("react");
export const ReactDOM = require("react-dom") as typeof import("react-dom");
(globalThis as unknown as { React: typeof React }).React = React;
export type Element = ReactElement<Record<string, unknown>>;

export function elements(node: ReactNode, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...elements(node.props.children as ReactNode, predicate),
  ];
}

export function element(node: ReactNode, predicate: (element: Element) => boolean): Element {
  const found = elements(node, predicate)[0];
  assert.ok(found, "缺少目标控件");
  return found;
}

export function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

/** 与已有查询组件测试一样执行 hooks，事件后重绘并清理 effect，不模拟浏览器布局。 */
export function mountClient(
  t: TestContext,
  render: () => ReactNode,
  bind: (tree: ReactNode) => void = () => {},
) {
  const slots: unknown[] = [];
  const effects: { deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let effectIndex = 0;
  let dirty = false;
  let queue: (() => void)[] = [];
  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  t.mock.method(React, "useState", <S>(initial: S | (() => S)) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? (initial as () => S)() : initial;
    return [
      slots[i],
      (next: S | ((old: S) => S)) => {
        const value = typeof next === "function" ? (next as (old: S) => S)(slots[i] as S) : next;
        dirty ||= !Object.is(slots[i], value);
        slots[i] = value;
      },
    ];
  });
  t.mock.method(React, "useRef", <S>(initial: S) => {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  });
  t.mock.method(React, "useCallback", (fn: unknown, deps: readonly unknown[]) => {
    const i = cursor++;
    const previous = slots[i] as { fn: unknown; deps: readonly unknown[] } | undefined;
    if (!previous || changed(previous.deps, deps)) slots[i] = { fn, deps };
    return (slots[i] as { fn: unknown }).fn;
  });
  const effect = (fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const i = effectIndex++;
    if (effects[i] && !changed(effects[i].deps, deps)) return;
    queue.push(() => {
      effects[i]?.cleanup?.();
      const cleanup = fn();
      effects[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
    });
  };
  t.mock.method(React, "useEffect", effect);
  t.mock.method(React, "useLayoutEffect", effect);
  t.mock.method(React, "useId", () => "test-menu");
  return {
    view() {
      let tree: ReactNode;
      let renders = 0;
      do {
        assert.ok(renders++ < 15, "组件未能稳定渲染");
        dirty = false;
        cursor = 0;
        effectIndex = 0;
        queue = [];
        tree = render();
        bind(tree);
        queue.forEach((run) => run());
      } while (dirty);
      return tree;
    },
    unmount() {
      effects.forEach((slot) => slot.cleanup?.());
    },
  };
}

/** 只提供本轮事件断言需要的节点能力；尺寸和真实 Tab 行为另由浏览器验证。 */
export function clientDom() {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const frames: FrameRequestCallback[] = [];
  const document = Object.assign(new EventTarget(), {
    activeElement: null as NodeStub | null,
    body: null as NodeStub | null,
    querySelectorAll: () => [] as NodeStub[],
  });
  class NodeStub extends EventTarget {
    children: NodeStub[] = [];
    disabled = false;
    visible = true;
    tabIndex = 0;
    indeterminate = false;
    style: Record<string, string> = {};
    parent: NodeStub | null = null;
    role = "";
    focused = 0;
    contains(node: unknown): boolean {
      return node === this || this.children.some((child) => child.contains(node));
    }
    focus() {
      this.focused++;
      document.activeElement = this;
    }
    getClientRects() {
      return this.visible ? [{}] : [];
    }
    getBoundingClientRect() {
      return { left: 120, right: 180, top: 100, bottom: 146, width: 160, height: 150 };
    }
    matches(selector: string) {
      return selector === ":disabled" && this.disabled;
    }
    closest(selector: string): NodeStub | null {
      return selector === "[inert]" ? null : this.parent;
    }
    querySelectorAll() {
      return this.children.filter((child) => !child.disabled);
    }
    querySelector() {
      return this.children.find((child) => child.role === "menu") ?? null;
    }
  }
  document.body = new NodeStub();
  document.activeElement = document.body;
  const viewport = Object.assign(new EventTarget(), {
    offsetTop: 0,
    offsetLeft: 0,
    width: 390,
    height: 844,
  });
  const window = Object.assign(new EventTarget(), { visualViewport: viewport });
  function install(key: string, value: unknown) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  install("Node", NodeStub);
  install("document", document);
  install("window", window);
  install("innerWidth", 390);
  install("innerHeight", 844);
  install("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.push(fn);
    return frames.length;
  });
  install("cancelAnimationFrame", () => {});
  return {
    Node: NodeStub,
    document,
    window,
    viewport,
    frames,
    flushFrames() {
      frames.splice(0).forEach((fn) => fn(0));
    },
    dispatch(target: EventTarget, type: string) {
      target.dispatchEvent(new Event(type));
    },
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

export function keyEvent(key: string, currentTarget: unknown, shiftKey = false) {
  return {
    key,
    currentTarget,
    shiftKey,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}
