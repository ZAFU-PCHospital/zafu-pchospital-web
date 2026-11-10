import assert from "node:assert/strict";
import test from "node:test";
import { activateFocusTrap } from "../../src/components/ui/useFocusTrap";

test("弹层循环 Tab、隔离背景，嵌套窗口只响应最上层 Escape 并恢复焦点", (t) => {
  const doc = Object.assign(new EventTarget(), {
    activeElement: null as unknown,
    body: null as unknown,
  });
  class Element {
    ownerDocument = doc;
    parentElement: Element | null = null;
    children: Element[] = [];
    style = { overflow: "auto" };
    inert = false;
    tabIndex = 0;
    isConnected = true;
    add(child: Element) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    }
    focus() {
      doc.activeElement = this;
    }
    contains(el: unknown): boolean {
      return el === this || this.children.some((child) => child.contains(el));
    }
    closest(): Element | null {
      return this.inert ? this : (this.parentElement?.closest() ?? null);
    }
    matches() {
      return false;
    }
    getAttribute() {
      return null;
    }
    getClientRects() {
      return [{}];
    }
    querySelectorAll(): Element[] {
      return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "HTMLElement", original);
    else Reflect.deleteProperty(globalThis, "HTMLElement");
  });
  const body = new Element();
  doc.body = body;
  const background = body.add(new Element());
  const trigger = background.add(new Element());
  trigger.focus();
  const first = body.add(new Element());
  const a = first.add(new Element());
  const b = first.add(new Element());
  let outerClose = 0;
  let innerClose = 0;
  const release = activateFocusTrap(first as unknown as HTMLElement, () => outerClose++);
  assert.equal(background.inert, true);
  assert.equal(body.style.overflow, "hidden");
  const key = (name: string, shift = false) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: name, shiftKey: shift });
    doc.dispatchEvent(event);
    return event;
  };
  b.focus();
  assert.equal(key("Tab").defaultPrevented, true);
  assert.equal(doc.activeElement, a);
  a.focus();
  key("Tab", true);
  assert.equal(doc.activeElement, b);
  const second = body.add(new Element());
  second.add(new Element());
  const releaseSecond = activateFocusTrap(second as unknown as HTMLElement, () => innerClose++);
  assert.equal(first.inert, true);
  key("Escape");
  assert.equal(innerClose, 1);
  assert.equal(outerClose, 0);
  releaseSecond();
  assert.equal(first.inert, false);
  assert.equal(background.inert, true);
  assert.equal(doc.activeElement, b);
  key("Escape");
  assert.equal(outerClose, 1);
  release();
  assert.equal(background.inert, false);
  assert.equal(doc.activeElement, trigger);
  assert.equal(body.style.overflow, "auto");
});
