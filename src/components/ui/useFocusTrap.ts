"use client";

import { useEffect, useRef, type RefObject } from "react";

const layers: HTMLElement[] = [];
const locks = new Map<HTMLElement, { count: number; inert: boolean }>();
let overflow = "";

/** 仅最上层窗口响应键盘；逐级隔离兄弟节点，兼容 Portal 和嵌套窗口。 */
export function activateFocusTrap(node: HTMLElement, onEscape: () => void) {
  const doc = node.ownerDocument;
  const trigger = doc.activeElement as HTMLElement | null;
  if (layers.length === 0) overflow = doc.body.style.overflow;
  layers.push(node);
  doc.body.style.overflow = "hidden";
  const siblings: HTMLElement[] = [];
  for (
    let current: HTMLElement | null = node;
    current?.parentElement;
    current = current.parentElement
  ) {
    for (const sibling of Array.from(current.parentElement.children)) {
      if (
        sibling === current ||
        !(sibling instanceof HTMLElement) ||
        sibling.getAttribute("aria-hidden") === "true"
      )
        continue;
      const lock = locks.get(sibling) ?? { count: 0, inert: sibling.inert };
      lock.count++;
      locks.set(sibling, lock);
      sibling.inert = true;
      siblings.push(sibling);
    }
    if (current.parentElement === doc.body) break;
  }
  node.focus({ preventScroll: true });
  const keydown = (event: KeyboardEvent) => {
    if (layers.at(-1) !== node) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      node.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]',
      ),
    ).filter(
      (el) =>
        el.tabIndex >= 0 &&
        !el.matches(":disabled") &&
        !el.closest("[inert]") &&
        el.getClientRects().length > 0,
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      node.focus({ preventScroll: true });
    } else if (
      !controls.includes(doc.activeElement as HTMLElement) ||
      (event.shiftKey && doc.activeElement === first) ||
      (!event.shiftKey && doc.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };
  const focusin = () => {
    if (layers.at(-1) === node && !node.contains(doc.activeElement))
      node.focus({ preventScroll: true });
  };
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("focusin", focusin);
  return () => {
    doc.removeEventListener("keydown", keydown, true);
    doc.removeEventListener("focusin", focusin);
    layers.splice(layers.indexOf(node), 1);
    for (const sibling of siblings) {
      const lock = locks.get(sibling)!;
      if (--lock.count === 0) {
        sibling.inert = lock.inert;
        locks.delete(sibling);
      }
    }
    if (layers.length === 0) doc.body.style.overflow = overflow;
    if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    else layers.at(-1)?.focus({ preventScroll: true });
  };
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  enabled = true,
) {
  const callback = useRef(onEscape);
  callback.current = onEscape;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    return activateFocusTrap(ref.current, () => callback.current());
  }, [enabled, ref]);
}
