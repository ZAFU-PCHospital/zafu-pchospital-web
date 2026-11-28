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
import { categoryAlias, keywordOf, siteAlias } from "@/features/tools/tool-aliases";
import { cn } from "@/lib/utils";
import {
  TOOL_CATEGORY_DESCRIPTION_MAX_LENGTH,
  TOOL_CATEGORY_LABEL_EN_MAX_LENGTH,
  type ToolCategoryAdminView,
  type ToolCategoryView,
  type ToolSiteView,
} from "@/types/contracts";

/**
 * 工具导航管理（`/admin/tools`）—— 卡片式。
 *
 * 卡片复用公开目录的视觉令牌，排序仅在完整分组中可用。
 */

const ALL = "all";

const bySort = (a: ToolSiteView, b: ToolSiteView) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

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
  const target = rest.filter((site) => site.categoryId === targetCategoryId).sort(bySort);
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

  // 新增后把新卡片滚进视野。
  useEffect(() => {
    if (!flashId) return;
    flashRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  /* ---------------------------------------------------------------- 分组视图 */

  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
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

  const keyword = keywordOf(query);
  const searching = keyword.length > 0;
  // 搜索时看到的是「筛选后的子集」，落点在全集里没有意义，所以禁止拖动。
  const dragDisabled = searching || busy;

  const groups = useMemo(
    () =>
      orderedCategories
        .filter((category) => active === ALL || category.id === active)
        .map((category) => {
          const all = sitesByCategory.get(category.id) ?? [];
          const categoryMatches = keywordOf(
            [
              category.name,
              category.labelEn,
              category.description,
              categoryAlias(category.name),
            ].join(" "),
          ).includes(keyword);
          const list =
            searching && !categoryMatches
              ? all.filter((site) =>
                  keywordOf(
                    [site.name, site.description, site.url, siteAlias(site.url)].join(" "),
                  ).includes(keyword),
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

  async function moveSite(siteId: string, targetCategoryId: string, beforeSiteId: string | null) {
    const site = sites.find((item) => item.id === siteId);
    if (!site || dragDisabled) return;

    const sameGroup = site.categoryId === targetCategoryId;
    if (sameGroup) {
      const list = sitesByCategory.get(targetCategoryId) ?? [];
      const from = list.findIndex((item) => item.id === siteId);
      const before = beforeSiteId
        ? list.findIndex((item) => item.id === beforeSiteId)
        : list.length;
      if (before === from || before === from + 1) return; // 落点没变：不发请求
    }

    const snapshot = sites;
    setSites((prev) => applyMove(prev, siteId, targetCategoryId, beforeSiteId));
    setBusy(true);
    setProblem("");

    try {
      const moved = await adminFetch<{ moved: boolean }>(
        `/api/v1/admin/tools/sites/${siteId}/move`,
        { method: "POST", body: { beforeId: beforeSiteId, categoryId: targetCategoryId } },
      );
      if (!moved.ok) throw new Error(moved.message);
      setToast({ text: copy.moved, tone: "success" });
    } catch (error) {
      setSites(snapshot);
      await load();
      reportFailure(error instanceof Error ? error.message : adminShared.loadFailed);
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
      reportFailure(result.message);
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
      reportFailure(result.message);
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
    return (event: DragEvent<HTMLSpanElement>) => {
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
      if (!dragId || dragDisabled || dragId === site.id) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setDrop({ siteId: site.id, after: event.clientX > rect.left + rect.width / 2 });
    };
  }

  function onCardDrop(site: ToolSiteView) {
    return (event: DragEvent<HTMLLIElement>) => {
      if (!dragId || dragDisabled || dragId === site.id) return;
      event.preventDefault();
      event.stopPropagation();
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

  function appendDrop(event: DragEvent<HTMLElement>, categoryId: string) {
    if (!dragId || dragDisabled || (event.target as HTMLElement).closest(".tpa-slot")) return;
    event.preventDefault();
    void moveSite(dragId, categoryId, null);
    resetDrag();
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

            <p className="tpa-note">{searching ? copy.dragOff : copy.dragOn}</p>

            {groups.map(({ category, list, all }) => {
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
                        aria-label={fill(copy.controlLabel, {
                          action: copy.groupTools.up,
                          name: category.name,
                        })}
                        onClick={() => void reorderCategory(category.id, "UP")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="tpa-step"
                        disabled={busy || position === orderedCategories.length - 1}
                        title={copy.groupTools.down}
                        aria-label={fill(copy.controlLabel, {
                          action: copy.groupTools.down,
                          name: category.name,
                        })}
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
                      className={cn("tpa-empty", dragId && !dragDisabled && "tpa-empty--droppable")}
                      disabled={busy}
                      onDragOver={(event) => {
                        if (!dragId || dragDisabled) return;
                        event.preventDefault();
                        setDrop(null);
                      }}
                      onDrop={(event) => appendDrop(event, category.id)}
                      onClick={() => setSiteModal({ mode: "create", categoryId: category.id })}
                    >
                      <Icon name="plus" />
                      {copy.emptyGroup}
                    </button>
                  ) : (
                    <ul
                      className="tp-grid"
                      onDragOver={(event) => {
                        if (dragId && !dragDisabled) event.preventDefault();
                      }}
                      onDrop={(event) => appendDrop(event, category.id)}
                    >
                      {list.map((site, position) => (
                        <li
                          key={site.id}
                          ref={flashId === site.id ? flashRef : undefined}
                          className={cn(
                            "tpa-slot",
                            dragId === site.id && "is-dragging",
                            drop?.siteId === site.id &&
                              (drop.after ? "is-drop-after" : "is-drop-before"),
                          )}
                          onDragOver={onCardDragOver(site)}
                          onDrop={onCardDrop(site)}
                        >
                          <div
                            className={cn(
                              "tp-card tpa-card",
                              !site.isActive && "tpa-card--off",
                              flashId === site.id && "tpa-new",
                            )}
                          >
                            <span
                              className="tpa-handle tp-card__icon"
                              aria-hidden="true"
                              draggable={!dragDisabled}
                              onDragStart={onCardDragStart(site)}
                              onDragEnd={resetDrag}
                              title={copy.dragHandle}
                            >
                              <Icon name="grip" />
                            </span>
                            <span className="tp-card__body">
                              <strong className="tp-card__name">{site.name}</strong>
                              <span className="tp-card__desc">
                                {site.description || hostOf(site.url)}
                              </span>
                              {!site.isActive && (
                                <span className="tpa-site-status">{copy.inactiveBadge}</span>
                              )}
                            </span>
                            <a
                              className="tpa-open"
                              href={site.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={site.url}
                              aria-label={fill(copy.controlLabel, {
                                action: copy.action.open,
                                name: site.name,
                              })}
                              draggable={false}
                            >
                              <Icon name="arrowUpRight" />
                            </a>
                            <span className="tpa-tools">
                              <button
                                type="button"
                                aria-disabled={dragDisabled || position === 0}
                                aria-label={fill(copy.controlLabel, {
                                  action: copy.groupTools.up,
                                  name: site.name,
                                })}
                                onClick={() => {
                                  if (position > 0)
                                    void moveSite(site.id, category.id, all[position - 1].id);
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-disabled={dragDisabled || position === all.length - 1}
                                aria-label={fill(copy.controlLabel, {
                                  action: copy.groupTools.down,
                                  name: site.name,
                                })}
                                onClick={() => {
                                  if (position < all.length - 1)
                                    void moveSite(
                                      site.id,
                                      category.id,
                                      all[position + 2]?.id ?? null,
                                    );
                                }}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={fill(copy.controlLabel, {
                                  action: copy.action.edit,
                                  name: site.name,
                                })}
                                onClick={() => setSiteModal({ mode: "edit", site })}
                              >
                                {copy.action.edit}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={fill(copy.controlLabel, {
                                  action: site.isActive
                                    ? copy.action.deactivate
                                    : copy.action.activate,
                                  name: site.name,
                                })}
                                onClick={() => void toggleSite(site)}
                              >
                                {site.isActive ? copy.action.deactivate : copy.action.activate}
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                disabled={busy}
                                aria-label={fill(copy.controlLabel, {
                                  action: copy.action.remove,
                                  name: site.name,
                                })}
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
                defaultValue={siteModal.mode === "edit" ? (siteModal.site.description ?? "") : ""}
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
            categoryModal.mode === "create"
              ? copy.categories.createTitle
              : copy.categories.editTitle
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
                maxLength={TOOL_CATEGORY_LABEL_EN_MAX_LENGTH}
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
                maxLength={TOOL_CATEGORY_DESCRIPTION_MAX_LENGTH}
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
