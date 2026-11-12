import assert from "node:assert/strict";
import test from "node:test";

import { activateFocusTrap } from "../../src/components/ui/useFocusTrap";
import { repairPhotoCopy } from "../../src/config/repairs";
import type { RepairPhotoView } from "../../src/types/contracts";
import { clientDom, element, mountClient } from "../support/react-client";

for (const nested of [false, true]) {
  test(`照片灯箱 body Portal：${nested ? "叠加详情窗口" : "独立打开"}时圈禁焦点、单层 Esc 与归还焦点`, async (t) => {
    const dom = clientDom();
    class FocusElement extends dom.Node {
      ownerDocument = dom.document;
      parentElement: FocusElement | null = null;
      inert = false;
      isConnected = true;
      add(child: FocusElement) {
        this.children.push(child);
        child.parentElement = this;
        return child;
      }
      focus() {
        if (this.closest("[inert]")) return;
        super.focus();
        dom.document.dispatchEvent(new Event("focusin"));
      }
      closest(selector: string): FocusElement | null {
        return selector === "[inert]" && this.inert
          ? this
          : (this.parentElement?.closest(selector) ?? null);
      }
      getAttribute() {
        return null;
      }
      querySelectorAll(): FocusElement[] {
        return (this.children as FocusElement[]).flatMap((child) => [
          child,
          ...child.querySelectorAll(),
        ]);
      }
      scrollTo() {}
    }
    const original = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FocusElement });
    const body = new FocusElement();
    body.style.overflow = "auto";
    dom.document.body = body;
    const background = body.add(new FocusElement());
    const pageTrigger = background.add(new FocusElement());
    pageTrigger.focus();
    const modal = nested ? body.add(new FocusElement()).add(new FocusElement()) : background;
    const thumbnail = modal.add(new FocusElement());
    let modalEscapes = 0;
    let lightboxEscapes = 0;
    const releaseModal = nested
      ? activateFocusTrap(modal as unknown as HTMLElement, () => modalEscapes++)
      : () => {};
    thumbnail.focus();
    const portal = body.add(new FocusElement());
    const lightbox = portal.add(new FocusElement());
    const close = lightbox.add(new FocusElement());
    const zoom = lightbox.add(new FocusElement());
    const stage = new FocusElement();
    const { PhotoLightboxView } = await import("../../src/components/repairs/PhotoLightbox");
    const photos = ["one", "two"].map(
      (id) => ({ id, contentUrl: `/photo/${id}`, width: 1280, height: 960 }) as RepairPhotoView,
    );
    let index = 0;
    const mounted = mountClient(
      t,
      () =>
        PhotoLightboxView({
          photos,
          index,
          onIndexChange: (value) => (index = value),
          onClose: () => lightboxEscapes++,
        }),
      (tree) => {
        const dialog = element(tree, (el) => el.props.role === "dialog");
        (dialog.props.ref as { current: unknown }).current = lightbox;
        const canvas = element(tree, (el) => String(el.props.className).includes("__stage"));
        (canvas.props.ref as { current: unknown }).current = stage;
      },
    );
    let unmounted = false;
    t.after(() => {
      if (!unmounted) mounted.unmount();
      releaseModal();
      dom.restore();
      if (original) Object.defineProperty(globalThis, "HTMLElement", original);
      else Reflect.deleteProperty(globalThis, "HTMLElement");
    });
    const key = (value: string, shiftKey = false) => {
      const event = new Event("keydown", { cancelable: true });
      Object.assign(event, { key: value, shiftKey });
      dom.document.dispatchEvent(event);
      return event;
    };

    mounted.view();
    assert.equal(dom.document.activeElement, lightbox, "父窗口不得抢回灯箱焦点");
    assert.equal(portal.closest("[inert]"), null);
    assert.equal(background.inert, true);
    assert.equal(body.style.overflow, "hidden");
    assert.equal(key("Tab").defaultPrevented, true);
    assert.equal(dom.document.activeElement, close);
    close.focus();
    key("Tab", true);
    assert.equal(dom.document.activeElement, zoom);
    key("Tab");
    assert.equal(dom.document.activeElement, close);

    index = 1;
    const tree = mounted.view();
    assert.equal(dom.document.activeElement, close, "切图不重新抢焦点");
    const dialog = element(tree, (el) => el.props.role === "dialog");
    const photoKey = (value: string) => {
      const event = { key: value, preventDefault() {}, stopPropagation() {} };
      (dialog.props.onKeyDown as (event: unknown) => void)(event);
    };
    photoKey("ArrowLeft");
    assert.equal(index, 0);
    mounted.view();
    photoKey("+");
    const zoomButton = element(
      mounted.view(),
      (el) => el.props.className === "photo-lightbox__zoom",
    );
    assert.equal(zoomButton.props["aria-pressed"], true);
    assert.equal(
      element(tree, (el) => el.props["aria-label"] === repairPhotoCopy.close).props.type,
      "button",
    );

    key("Escape");
    assert.equal(lightboxEscapes, 1);
    assert.equal(modalEscapes, 0);
    mounted.unmount();
    unmounted = true;
    assert.equal(dom.document.activeElement, thumbnail);
    assert.equal(body.style.overflow, nested ? "hidden" : "auto");
    if (nested) {
      assert.equal(modal.closest("[inert]"), null);
      assert.equal(background.inert, true);
      key("Escape");
      assert.equal(modalEscapes, 1);
    }
  });
}
