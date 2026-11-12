import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ReactNode } from "react";
import { setImmediate } from "node:timers/promises";

import { clientDom, element, elements, mountClient, ReactDOM, text } from "../support/react-client";
import { communityCopy } from "../../src/config/community";
import type { FavoriteView, NotificationView } from "../../src/types/contracts";

type Deferred = {
  url: string;
  resolve: (response: Response) => void;
};

async function mountWithFetch<T extends ReactNode>(
  t: TestContext,
  component: () => T,
  requests: Deferred[],
) {
  const dom = clientDom();
  t.mock.method(
    ReactDOM,
    "createPortal",
    ((node: ReactNode) => node) as typeof ReactDOM.createPortal,
  );
  t.mock.method(
    globalThis,
    "fetch",
    (input: unknown) =>
      new Promise<Response>((resolve) => {
        requests.push({ url: String(input), resolve });
      }),
  );
  const mounted = mountClient(t, component);
  t.after(() => {
    mounted.unmount();
    dom.restore();
  });
  const view = () => mounted.view();
  view();
  await setImmediate();
  return { dom, view };
}

const notification: NotificationView = {
  id: "notification-1",
  type: "REPAIR_APPROVED",
  status: "UNREAD",
  repairRecordId: null,
  commentId: null,
  actor: null,
  repairExcerpt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  readAt: null,
};

const favorite: FavoriteView = {
  id: "favorite-1",
  repairRecordId: "repair-1",
  repairDate: "2026-11-01",
  categoryName: "系统问题",
  contentExcerpt: "收藏的维修记录",
  memberName: "张三",
  isDifficult: false,
  isTypical: false,
  createdAt: "2026-11-01T00:00:00.000Z",
};

function buttonByText(tree: ReactNode, label: string) {
  return element(
    tree,
    (item) =>
      typeof item.props.onClick === "function" && text(item.props.children as ReactNode) === label,
  );
}

test("通知写失败：在途防重、按钮忙碌、失败提示可见", async (t) => {
  const requests: Deferred[] = [];
  const { NotificationInbox } = await import("../../src/components/community/NotificationInbox");
  const { view } = await mountWithFetch(t, () => NotificationInbox(), requests);
  assert.equal(requests.length, 1);
  requests.shift()!.resolve(
    Response.json({
      success: true,
      data: { items: [notification], unreadCount: 1 },
      meta: { pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
    }),
  );
  await setImmediate();
  view();

  (buttonByText(view(), communityCopy.notifications.delete).props.onClick as () => void)();
  view();
  assert.equal(requests.length, 1);
  const deleteButton = buttonByText(view(), communityCopy.notifications.marking);
  assert.equal(deleteButton.props.disabled, true);
  (deleteButton.props.onClick as () => void)();
  assert.equal(requests.length, 1, "在途时再次点击不能再发写请求");

  requests.shift()!.resolve(Response.json({ success: false, error: { message: "删除失败" } }));
  await setImmediate();
  view();
  assert.equal(
    elements(view(), (item) => item.props.message === "删除失败").length,
    1,
    "失败信息必须保留可见",
  );
});

test("收藏删除成功后保留列表上下文并刷新数据", async (t) => {
  const requests: Deferred[] = [];
  const { FavoriteList, FavoriteRow } = await import("../../src/components/community/FavoriteList");
  const { CommunityListSkeleton } =
    await import("../../src/components/community/CommunityListSkeleton");
  const { view } = await mountWithFetch(t, () => FavoriteList(), requests);
  assert.equal(requests.length, 1);
  requests.shift()!.resolve(
    Response.json({
      success: true,
      data: [favorite],
      meta: { pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
    }),
  );
  await setImmediate();
  view();

  (buttonByText(view(), communityCopy.favorites.remove).props.onClick as () => void)();
  view();
  assert.equal(requests.length, 1);
  requests.shift()!.resolve(Response.json({ success: true }));
  await setImmediate();
  view();
  assert.equal(requests.length, 1, "成功后应重读列表");
  assert.equal(
    elements(view(), (item) => item.type === CommunityListSkeleton).length,
    0,
    "后台刷新不能把已渲染列表换回骨架",
  );
  assert.equal(elements(view(), (item) => item.type === FavoriteRow).length, 1);
  requests.shift()!.resolve(
    Response.json({
      success: true,
      data: [{ ...favorite, id: "favorite-2", contentExcerpt: "刷新后的收藏" }],
      meta: { pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
    }),
  );
  await setImmediate();
  await setImmediate();
  const rows = elements(view(), (item) => item.type === FavoriteRow);
  assert.equal(rows.length, 1);
  assert.equal(
    (rows[0].props.item as FavoriteView).contentExcerpt,
    "刷新后的收藏",
    "成功后应刷新列表数据",
  );
});
