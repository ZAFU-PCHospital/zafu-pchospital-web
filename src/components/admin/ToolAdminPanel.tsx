"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";

import { AdminListSkeleton } from "@/components/admin/AdminListSkeleton";
import { AdminModal } from "@/components/admin/AdminModal";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import { cn } from "@/lib/utils";
import type { ToolCategoryAdminView, ToolCategoryView, ToolSiteView } from "@/types/contracts";

/**
 * 工具导航管理（`/admin/tools`）—— 卡片式。
 *
 * **与公开页同一套视觉**：这里直接复用 `src/app/docs/tools.css` 的 `.tp-*` 类与
 * `--tp-*` 变量（页面在 `src/app/admin/tools/page.tsx` 里 import），后台看到的网格、
 * 卡片尺寸、分组标题与 `/docs` 完全一致。早先那版是「表格式后台 + 另一种弹窗」，
 * 管理员改完还得切到前台确认一遍；现在改哪张卡、前台就是哪张卡，位置也一样。
 *
 * 交互约定：
 * - **拖卡片 = 排序**：同一分组内换位；拖进别的分组 = 换分类（先 PATCH `categoryId`
 *   再 POST `move`，两步都成功才算数，失败整体回滚 + 报错）。
 * - 拖动期间只改本地状态，松手才发请求 —— 否则每一格 `dragover` 都写一次库。
 * - **搜索时禁用拖动**：筛选后的落点没有意义（看不见的行也在参与排序）。
 * - 卡片右上一排「改 / 停 / 删」，悬停才出现，不改变卡片高度与列宽。
 */

const ALL = "all";

const bySort = (a: ToolSiteView, b: ToolSiteView) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/** 把 `{count}` 这类占位符替换成实际数字。 */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

/** 卡片副标题：没写说明就退回到域名，空着比省略号好读。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * 拖动落点的本地重排（纯函数，便于出错时整份回滚）。
 *
 * `sortOrder` 是**组内**序号，所以换组时两组都要重新压平成 `0..n-1`，
 * 否则「上移一格」在有空隙的数据上会看起来没反应。
 */
function applyMove(
  prev: readonly ToolSiteView[],
  siteId: string,
  targetCategoryId: string,
  beforeSiteId: string | null,
): ToolSiteView[] {
  const moving = prev.find((site) => site.id === siteId);
  if (!moving) return [...prev];

  const rest = prev.filter((site) => site.id !== siteId).map((site) => ({ ...site }));
  const target = rest.filter((site) => site.categoryId === targetCategoryId);
  const beforeAt = beforeSiteId ? target.findIndex((site) => site.id === beforeSiteId) : -1;
  const insertAt = beforeAt >= 0 ? beforeAt : target.length;

  const ordered = [
    ...target.slice(0, insertAt),
    { ...moving, categoryId: targetCategoryId },
    ...target.slice(insertAt),
  ];
  ordered.forEach((site, index) => {
    site.sortOrder = index;
  });

  if (moving.categoryId !== targetCategoryId) {
    const source = rest.filter((site) => site.categoryId === moving.categoryId).sort(bySort);
    source.forEach((site, index) => {
      site.sortOrder = index;
    });
  }

  const byId = new Map(rest.map((site) => [site.id, site]));
  ordered.forEach((site) => byId.set(site.id, site));
  return [...byId.values()];
}

export function ToolAdminPanel() {
  const copy = adminCopy.tools;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<ToolCategoryAdminView[]>([]);
  const [sites, setSites] = useState<ToolSiteView[]>([]);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(ALL);

  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ siteId: string; after: boolean } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashRef = useRef<HTMLLIElement | null>(null);

  const [siteModal, setSiteModal] = useState<
    { mode: "create"; categoryId?: string } | { mode: "edit"; site: ToolSiteView } | null
  >(null);
  const [categoryModal, setCategoryModal] = useState<
    { mode: "create" } | { mode: "edit"; category: ToolCategoryAdminView } | null
  >(null);
  const [removeSite, setRemoveSite] = useState<ToolSiteView | null>(null);
  const [removeCategory, setRemoveCategory] = useState<ToolCategoryAdminView | null>(null);

  const load = useCallback(async () => {
    // 重新加载时不清空内容：一旦卸载，页面高度会塌下来，滚动位置被夹回顶部。
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const [categoryResult, siteResult] = await Promise.all([
      adminFetch<ToolCategoryAdminView[]>("/api/v1/admin/tools/categories"),
      adminFetch<ToolSiteView[]>("/api/v1/admin/tools/sites"),
    ]);
    if (!categoryResult.ok) {
      setStatus("error");
      setProblem(categoryResult.message);
      return;
    }
    if (!siteResult.ok) {
      setStatus("error");
      setProblem(siteResult.message);
      return;
    }
    setCategories(categoryResult.data);
    setSites(siteResult.data);
    setStatus("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 新增后把那张卡滚进视野：一屏 28 张，不提示等于没加。
  useEffect(() => {
    if (!flashId) return;
    flashRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  /* ---------------------------------------------------------------- 分组视图 */

  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories],
  );

  const sitesByCategory = useMemo(() => {
    const map = new Map<string, ToolSiteView[]>();
    for (const site of sites) {
      const bucket = map.get(site.categoryId);
      if (bucket) bucket.push(site);
      else map.set(site.categoryId, [site]);
    }
    for (const bucket of map.values()) bucket.sort(bySort);
    return map;
  }, [sites]);

  const keyword = query.trim().toLowerCase();
  const searching = keyword.length > 0;
  // 搜索时看到的是「筛选后的子集」，落点在全集里没有意义，所以禁止拖动。
  const dragDisabled = searching || busy;

  const groups = useMemo(
    () =>
      orderedCategories
        .filter((category) => active === ALL || category.id === active)
        .map((category) => {
          const all = sitesByCategory.get(category.id) ?? [];
          const list = searching
            ? all.filter(
                (site) =>
                  site.name.toLowerCase().includes(keyword) ||
                  (site.description ?? "").toLowerCase().includes(keyword) ||
                  site.url.toLowerCase().includes(keyword),
              )
            : all;
          return { category, all, list };
        })
        .filter((group) => !searching || group.list.length > 0),
    [orderedCategories, sitesByCategory, active, searching, keyword],
  );

  const total = sites.length;
  const shown = groups.reduce((sum, group) => sum + group.list.length, 0);
  const filtered = searching || active !== ALL;
  const activeCategories = orderedCategories.filter((category) => category.isActive);

  /* ---------------------------------------------------------------- 网站操作 */

  function reportFailure(message: string) {
    setProblem(message);
    setToast(null);
  }

  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<ToolSiteView>("/api/v1/admin/tools/sites", {
      method: "POST",
      body: {
        name: data.name ?? "",
        url: data.url ?? "",
        categoryId: data.categoryId ?? "",
        description: data.description || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      reportFailure(result.code === "TOOL_SITE_CONFLICT" ? copy.create.conflict : result.message);
      return;
    }
    setSiteModal(null);
    setToast({ text: copy.create.created, tone: "success" });
    // 先把筛掉的条件清掉，否则新卡可能落在当前筛选之外，加完什么也看不见。
    setQuery("");
    setActive(ALL);
    await load();
    setFlashId(result.data.id);
  }

  async function saveSite(event: FormEvent<HTMLFormElement>, site: ToolSiteView) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<ToolSiteView>(`/api/v1/admin/tools/sites/${site.id}`, {
      method: "PATCH",
      body: {
        name: data.name ?? "",
        url: data.url ?? "",
        categoryId: data.categoryId ?? site.categoryId,
        description: data.description || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      reportFailure(result.code === "TOOL_SITE_CONFLICT" ? copy.create.conflict : result.message);
      return;
    }
    setSiteModal(null);
    setToast({ text: copy.saved, tone: "success" });
    await load();
    setFlashId(result.data.id);
  }

  async function toggleSite(site: ToolSiteView) {
    setBusy(true);
    setProblem("");
    const path = site.isActive ? "deactivate" : "activate";
    const result = await adminFetch<ToolSiteView>(`/api/v1/admin/tools/sites/${site.id}/${path}`, {
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      reportFailure(result.message);
      return;
    }
    setToast({
      text: site.isActive ? copy.deactivated : copy.activated,
      tone: site.isActive ? "neutral" : "success",
    });
    await load();
  }

  async function confirmRemoveSite() {
    if (!removeSite) return;
    setBusy(true);
    setProblem("");
    const result = await adminFetch<{ removed: boolean }>(
      `/api/v1/admin/tools/sites/${removeSite.id}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      reportFailure(result.message);
      return;
    }
    setRemoveSite(null);
    setToast({ text: copy.removed, tone: "neutral" });
    await load();
  }

  /* ---------------------------------------------------------------- 排序 */

  /**
   * 拖动落地。
   *
   * 同一分组 → 一个 `POST /move`。
   * 跨分组 → 先 `PATCH categoryId` 换组，再 `POST /move` 定位：
   * 顺序不能反 —— `move` 按「当前所在分组」取全集，没换组就拖，插入点会落在旧分组里。
   * 两步之间失败会留下「换了组但没定位」的中间态，所以失败时用快照整份回滚。
   */
  async function moveSite(siteId: string, targetCategoryId: string, beforeSiteId: string | null) {
    const site = sites.find((item) => item.id === siteId);
    if (!site) return;

    const sameGroup = site.categoryId === targetCategoryId;
    if (sameGroup) {
      const list = sitesByCategory.get(targetCategoryId) ?? [];
      const from = list.findIndex((item) => item.id === siteId);
      const before = beforeSiteId ? list.findIndex((item) => item.id === beforeSiteId) : list.length;
      if (before === from || before === from + 1) return; // 落点没变：不发请求
    }

    const snapshot = sites;
    setSites((prev) => applyMove(prev, siteId, targetCategoryId, beforeSiteId));
    setBusy(true);
    setProblem("");

    try {
      if (!sameGroup) {
        const patched = await adminFetch<ToolSiteView>(`/api/v1/admin/tools/sites/${siteId}`, {
          method: "PATCH",
          body: { categoryId: targetCategoryId },
        });
        if (!patched.ok) throw new Error(patched.message);
      }
      const moved = await adminFetch<{ moved: boolean }>(
        `/api/v1/admin/tools/sites/${siteId}/move`,
        { method: "POST", body: { beforeId: beforeSiteId } },
      );
      if (!moved.ok) throw new Error(moved.message);
      setToast({ text: copy.moved, tone: "success" });
    } catch (error) {
      setSites(snapshot);
      reportFailure(error instanceof Error ? error.message : copy.moved);
      // 跨组失败时库里的分类可能已经变了，读一次真值比任凭本地猜更稳。
      await load();
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- 分类操作 */

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<ToolCategoryView>("/api/v1/admin/tools/categories", {
      method: "POST",
      body: {
        name: data.name ?? "",
        labelEn: data.labelEn || null,
        description: data.description || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      reportFailure(
        result.code === "TOOL_CATEGORY_CONFLICT" ? copy.categories.conflict : result.message,
      );
      return;
    }
    setCategoryModal(null);
    setToast({ text: copy.categories.created, tone: "success" });
    await load();
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>, category: ToolCategoryAdminView) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<ToolCategoryView>(
      `/api/v1/admin/tools/categories/${category.id}`,
      {
        method: "PATCH",
        body: {
          name: data.name ?? "",
          labelEn: data.labelEn || null,
          description: data.description || null,
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      reportFailure(
        result.code === "TOOL_CATEGORY_CONFLICT" ? copy.categories.conflict : result.message,
      );
      return;
    }
    setCategoryModal(null);
    setToast({ text: copy.categories.saved, tone: "success" });
    await load();
  }

  async function toggleCategory(category: ToolCategoryAdminView) {
    setBusy(true);
    setProblem("");
    const path = category.isActive ? "deactivate" : "activate";
    const result = await adminFetch<ToolCategoryView>(
      `/api/v1/admin/tools/categories/${category.id}/${path}`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      reportFailure(result.message);
      return;
    }
    setToast({
      text: category.isActive ? copy.deactivated : copy.activated,
      tone: category.isActive ? "neutral" : "success",
    });
    await load();
  }

  async function reorderCategory(categoryId: string, direction: "UP" | "DOWN") {
    setBusy(true);
    setProblem("");
    const result = await adminFetch<{ reordered: boolean }>(
      `/api/v1/admin/tools/categories/${categoryId}/reorder`,
      { method: "POST", body: { direction } },
    );
    setBusy(false);
    if (!result.ok) {
      reportFailure(result.message);
      return;
    }
    await load();
  }

  async function confirmRemoveCategory() {
    if (!removeCategory) return;
    setBusy(true);
    setProblem("");
    const result = await adminFetch<{ removed: boolean }>(
      `/api/v1/admin/tools/categories/${removeCategory.id}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      reportFailure(
        result.code === "TOOL_CATEGORY_CONFLICT" ? copy.categories.hasSites : result.message,
      );
      return;
    }
    setRemoveCategory(null);
    setToast({ text: copy.categories.removed, tone: "neutral" });
    await load();
  }

  /* ---------------------------------------------------------------- 拖动事件 */

  function onCardDragStart(site: ToolSiteView) {
    return (event: DragEvent<HTMLLIElement>) => {
      if (dragDisabled) {
        event.preventDefault();
        return;
      }
      setDragId(site.id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", site.id);
    };
  }

  function onCardDragOver(site: ToolSiteView) {
    return (event: DragEvent<HTMLLIElement>) => {
      if (!dragId || dragId === site.id) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setDrop({ siteId: site.id, after: event.clientX > rect.left + rect.width / 2 });
    };
  }

  function onCardDrop(site: ToolSiteView) {
    return (event: DragEvent<HTMLLIElement>) => {
      if (!dragId) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      // 插到某张卡后面 = 插到它下一张卡前面；没有下一张就落到组末尾。
      const siblings = (sitesByCategory.get(site.categoryId) ?? []).filter(
        (item) => item.id !== dragId,
      );
      const at = siblings.findIndex((item) => item.id === site.id);
      const beforeId = after ? (siblings[at + 1]?.id ?? null) : site.id;
      const moving = dragId;
      setDragId(null);
      setDrop(null);
      void moveSite(moving, site.categoryId, beforeId);
    };
  }

  function resetDrag() {
    setDragId(null);
    setDrop(null);
  }

  /* ---------------------------------------------------------------- 渲染 */

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-tools-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
        <div className="tpa-actions">
          <Button variant="ghost" icon="plus" onClick={() => setCategoryModal({ mode: "create" })}>
            {copy.categories.add}
          </Button>
          <Button
            variant="solid"
            icon="plus"
            disabled={activeCategories.length === 0}
            onClick={() => setSiteModal({ mode: "create" })}
          >
            {copy.create.title}
          </Button>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      {status === "loading" ? <AdminListSkeleton /> : null}

      {status === "error" ? (
        <Card variant="notice">
          <p>{problem || adminShared.loadFailed}</p>
          <Button onClick={() => void load()}>{adminShared.reload}</Button>
        </Card>
      ) : null}

      {status === "ready" && categories.length === 0 ? (
        <Card variant="notice">
          <p>{copy.emptyNote}</p>
          <Button variant="solid" icon="plus" onClick={() => setCategoryModal({ mode: "create" })}>
            {copy.categories.add}
          </Button>
        </Card>
      ) : null}

      {status === "ready" && categories.length > 0 ? (
        <div className="tp tpa">
          <div className="tp-dir">
            <div className="tp-dir__head">
              <h2>{copy.dirTitle}</h2>
              <span>
                {filtered
                  ? fill(copy.countFiltered, { shown, total })
                  : fill(copy.countTotal, { count: total })}
              </span>
            </div>

            <div className="tp-search">
              <Icon name="zoomIn" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.search}
                aria-label={copy.search}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                }}
              />
            </div>

            <div className="tp-filters" role="group" aria-label={copy.dirTitle}>
              <button
                type="button"
                aria-pressed={active === ALL}
                className={cn("tp-filter", active === ALL && "is-on")}
                onClick={() => setActive(ALL)}
              >
                {copy.all} {total}
              </button>
              {orderedCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={active === category.id}
                  className={cn("tp-filter", active === category.id && "is-on")}
                  onClick={() => setActive(category.id)}
                >
                  {category.name} {sitesByCategory.get(category.id)?.length ?? 0}
                </button>
              ))}
            </div>

            <p className="tpa-note">{dragDisabled && !busy ? copy.dragOff : copy.dragOn}</p>

            {groups.map(({ category, list }) => {
              const position = orderedCategories.findIndex((item) => item.id === category.id);
              return (
                <section className="tp-group" key={category.id}>
                  <div className="tp-group__head tpa-group__head">
                    <h3 className="tp-group__name">
                      {category.name}
                      <em>{list.length}</em>
                      {category.isActive ? null : (
                        <span className="tpa-off-flag">{copy.inactiveBadge}</span>
                      )}
                    </h3>
                    <div className="tpa-group__tools">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSiteModal({ mode: "create", categoryId: category.id })}
                      >
                        {copy.groupTools.addSite}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCategoryModal({ mode: "edit", category })}
                      >
                        {copy.groupTools.edit}
                      </button>
                      <button
                        type="button"
                        className="tpa-step"
                        disabled={busy || position <= 0}
                        title={copy.groupTools.up}
                        onClick={() => void reorderCategory(category.id, "UP")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="tpa-step"
                        disabled={busy || position === orderedCategories.length - 1}
                        title={copy.groupTools.down}
                        onClick={() => void reorderCategory(category.id, "DOWN")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleCategory(category)}
                      >
                        {category.isActive ? copy.action.deactivate : copy.action.activate}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busy}
                        onClick={() => setRemoveCategory(category)}
                      >
                        {copy.groupTools.remove}
                      </button>
                    </div>
                    <span className="tp-group__en">{category.labelEn || category.code}</span>
                  </div>

                  {list.length === 0 ? (
                    <button
                      type="button"
                      className="tpa-empty"
                      onClick={() => setSiteModal({ mode: "create", categoryId: category.id })}
                    >
                      <Icon name="plus" />
                      {copy.emptyGroup}
                    </button>
                  ) : (
                    <ul
                      className="tp-grid"
                      onDragOver={(event) => {
                        if (!dragId) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!dragId) return;
                        // 落在卡片之间的空隙（不是某张卡上）= 追加到这一组末尾
                        if ((event.target as HTMLElement).closest(".tpa-slot")) return;
                        event.preventDefault();
                        const moving = dragId;
                        setDragId(null);
                        setDrop(null);
                        void moveSite(moving, category.id, null);
                      }}
                    >
                      {list.map((site) => (
                        <li
                          key={site.id}
                          ref={flashId === site.id ? flashRef : undefined}
                          className={cn(
                            "tpa-slot",
                            dragId === site.id && "is-dragging",
                            drop?.siteId === site.id &&
                              (drop.after ? "is-drop-after" : "is-drop-before"),
                          )}
                          draggable={!dragDisabled}
                          onDragStart={onCardDragStart(site)}
                          onDragOver={onCardDragOver(site)}
                          onDrop={onCardDrop(site)}
                          onDragEnd={resetDrag}
                        >
                          <div
                            className={cn(
                              "tp-card tpa-card",
                              !site.isActive && "tpa-card--off",
                              flashId === site.id && "tpa-new",
                            )}
                          >
                            <span className="tp-card__icon" aria-hidden="true">
                              {site.name.slice(0, 1)}
                            </span>
                            <span className="tp-card__body">
                              <strong className="tp-card__name">{site.name}</strong>
                              <span className="tp-card__desc">
                                {site.description || hostOf(site.url)}
                              </span>
                            </span>
                            <a
                              className="tpa-open"
                              href={site.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={site.url}
                              aria-label={`打开 ${site.name}`}
                              draggable={false}
                              onMouseDown={(event) => event.stopPropagation()}
                            >
                              <Icon name="arrowUpRight" />
                            </a>
                            <span className="tpa-tools">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setSiteModal({ mode: "edit", site })}
                              >
                                {copy.action.edit}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void toggleSite(site)}
                              >
                                {site.isActive ? copy.action.deactivate : copy.action.activate}
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                disabled={busy}
                                onClick={() => setRemoveSite(site)}
                              >
                                {copy.action.remove}
                              </button>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}

            {groups.length === 0 ? <p className="tp-empty">{copy.noMatch}</p> : null}
          </div>
        </div>
      ) : null}

      {siteModal ? (
        <AdminModal
          title={siteModal.mode === "create" ? copy.create.title : copy.editTitle}
          size="narrow"
          onClose={() => setSiteModal(null)}
        >
          <form
            className="admin-form"
            method="post"
            onSubmit={(event) =>
              void (siteModal.mode === "create"
                ? createSite(event)
                : saveSite(event, siteModal.site))
            }
            aria-label={siteModal.mode === "create" ? copy.create.title : copy.editTitle}
          >
            <label className="field">
              <span className="field__label">{copy.create.name}</span>
              <input
                className="field__input"
                name="name"
                required
                maxLength={80}
                autoComplete="off"
                placeholder={copy.create.nameHint}
                defaultValue={siteModal.mode === "edit" ? siteModal.site.name : ""}
              />
            </label>

            <label className="field">
              <span className="field__label">{copy.create.url}</span>
              <input
                className="field__input"
                name="url"
                type="url"
                required
                maxLength={500}
                inputMode="url"
                placeholder="https://"
                autoComplete="off"
                defaultValue={siteModal.mode === "edit" ? siteModal.site.url : ""}
              />
              <span className="field__hint">{copy.create.urlHint}</span>
            </label>

            <label className="field">
              <span className="field__label">{copy.create.category}</span>
              <select
                className="field__input"
                name="categoryId"
                required
                defaultValue={
                  siteModal.mode === "edit"
                    ? siteModal.site.categoryId
                    : (siteModal.categoryId ?? activeCategories[0]?.id)
                }
              >
                {orderedCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.isActive ? "" : `（${copy.inactiveBadge}）`}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">{copy.create.description}</span>
              <input
                className="field__input"
                name="description"
                maxLength={200}
                autoComplete="off"
                placeholder={copy.create.descriptionHint}
                defaultValue={
                  siteModal.mode === "edit" ? (siteModal.site.description ?? "") : ""
                }
              />
            </label>

            <div className="signup__actions">
              <Button type="submit" variant="solid" disabled={busy}>
                {siteModal.mode === "create" ? copy.create.submit : copy.action.save}
              </Button>
              <Button variant="ghost" onClick={() => setSiteModal(null)}>
                {copy.create.cancel}
              </Button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {categoryModal ? (
        <AdminModal
          title={
            categoryModal.mode === "create" ? copy.categories.createTitle : copy.categories.editTitle
          }
          onClose={() => setCategoryModal(null)}
          size="compact"
        >
          <form
            className="admin-form"
            method="post"
            onSubmit={(event) =>
              void (categoryModal.mode === "create"
                ? createCategory(event)
                : saveCategory(event, categoryModal.category))
            }
            aria-label={
              categoryModal.mode === "create"
                ? copy.categories.createTitle
                : copy.categories.editTitle
            }
          >
            <label className="field">
              <span className="field__label">{copy.categories.name}</span>
              <input
                className="field__input"
                name="name"
                required
                maxLength={80}
                autoComplete="off"
                placeholder={copy.categories.nameHint}
                defaultValue={categoryModal.mode === "edit" ? categoryModal.category.name : ""}
              />
            </label>

            <label className="field">
              <span className="field__label">{copy.categories.labelEn}</span>
              <input
                className="field__input"
                name="labelEn"
                maxLength={64}
                autoComplete="off"
                placeholder={copy.categories.labelEnHint}
                defaultValue={
                  categoryModal.mode === "edit" ? (categoryModal.category.labelEn ?? "") : ""
                }
              />
            </label>

            <label className="field">
              <span className="field__label">{copy.categories.description}</span>
              <input
                className="field__input"
                name="description"
                maxLength={200}
                autoComplete="off"
                defaultValue={
                  categoryModal.mode === "edit" ? (categoryModal.category.description ?? "") : ""
                }
              />
            </label>

            <div className="signup__actions">
              <Button type="submit" variant="solid" disabled={busy}>
                {categoryModal.mode === "create" ? copy.categories.submit : copy.categories.save}
              </Button>
              <Button variant="ghost" onClick={() => setCategoryModal(null)}>
                {copy.action.cancel}
              </Button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {removeSite ? (
        <AdminModal title={copy.action.remove} onClose={() => setRemoveSite(null)} size="compact">
          <p>{fill(copy.removeConfirm, { name: removeSite.name })}</p>
          <div className="signup__actions">
            <Button variant="solid" disabled={busy} onClick={() => void confirmRemoveSite()}>
              {copy.removeSubmit}
            </Button>
            <Button variant="ghost" onClick={() => setRemoveSite(null)}>
              {copy.action.cancel}
            </Button>
          </div>
        </AdminModal>
      ) : null}

      {removeCategory ? (
        <AdminModal
          title={copy.groupTools.remove}
          onClose={() => setRemoveCategory(null)}
          size="compact"
        >
          <p>{fill(copy.categories.removeConfirm, { name: removeCategory.name })}</p>
          <div className="signup__actions">
            <Button variant="solid" disabled={busy} onClick={() => void confirmRemoveCategory()}>
              {copy.removeSubmit}
            </Button>
            <Button variant="ghost" onClick={() => setRemoveCategory(null)}>
              {copy.action.cancel}
            </Button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
