"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminApiResult } from "@/features/admin/admin-client";
import { applyOrder, movedManyIds } from "@/lib/list-order";
import { requestError, withRequest } from "@/lib/client/request";
import type { PaginationMeta } from "@/types/contracts";
import type { TableGroupSummary } from "@/types/table";

/** 后台列表追加分页数据；刷新时保留已加载内容与选择。 */
export type AdminListController<T> = {
  items: T[];
  pagination: PaginationMeta | null;
  page: number;
  state: "loading" | "ready" | "error";
  problem: string;
  loadingMore: boolean;
  refreshing: boolean;
  summary?: TableGroupSummary;
  /** 重新取第一页（筛选变化、写操作之后调用）。 */
  reload: () => Promise<void>;
  /** 写操作后刷新已加载的页数，保留长列表上下文。 */
  refreshLoaded: () => Promise<void>;
  /** 追加下一页；刷新期间合并排队，追加期间保持单飞。 */
  loadMore: () => void;
  /**
   * **乐观排序**：按 `lib/list-order.ts` 的同一套规则把本地顺序先改掉，并返回改动前的
   * id 顺序（失败时交给 {@link setOrder} 回滚）。
   *
   * 为什么要它：拖动排序松手后如果等接口 + 重新取列表，用户会看到行「顿一下才到位」，
   * 反馈就是「不是立即响应修改的」。排序规则两边共用，所以本地先改的结果与服务端一致，
   * 不必等往返。服务端最终仍会写库；界面在失败时回滚并报错。
   */
  reorder: (movingIds: string[], beforeId: string | null) => string[];
  /** 把顺序恢复成给定的 id 顺序（乐观更新失败时回滚；缺的 id 排在末尾）。 */
  setOrder: (ids: string[]) => void;
  /**
   * **就地改一行**：把服务端确认过的字段合并进列表里的那一条。
   *
   * 为什么不改完就 `reload()`：重取会把无限下翻出来的几页缩回第一页（与 `reorder`
   * 同一个判断）。调用方必须传**服务端返回值**（含新的 `version`），本地不自己推算
   * 版本号 —— 版本号只有一个来源，界面猜一定会漂。
   */
  patch: (id: string, fields: Partial<T>) => void;
};

export function useAdminList<T extends { id: string }>(
  fetchPage: (page: number, signal?: AbortSignal) => Promise<AdminApiResult<T[]>>,
  options: { queryKey?: string | null } = {},
): AdminListController<T> {
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const pageRef = useRef(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<TableGroupSummary | undefined>();

  // 每次渲染都更新引用：fetchPage 闭包捕获了当前筛选条件，取值时要用最新的一份。
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  // 并发保护：滚动会连续触发，避免同一页被拉两次。
  const inFlight = useRef(false);
  const requestDone = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const appending = useRef(false);
  const queuedMore = useRef<object | null>(null);
  const paginationRef = useRef<PaginationMeta | null>(null);

  const run = useCallback(async (targetPage: number, append: boolean, refreshLoaded = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    appending.current = append;
    const requestGeneration = generation.current;
    const active = new AbortController();
    controller.current = active;
    const fetchPage = fetchRef.current;
    const fetch = (page: number) =>
      withRequest((signal) => fetchPage(page, signal), { signal: active.signal });
    let completeRequest = () => {};
    requestDone.current = new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    if (append) setLoadingMore(true);
    else setState((current) => (current === "ready" ? "ready" : "loading"));
    setRefreshing(true);
    setProblem("");

    try {
      let result = await fetch(refreshLoaded ? 1 : targetPage);
      if (requestGeneration !== generation.current) return;
      if (refreshLoaded && result.ok) {
        result = { ...result, data: [...result.data] };
        const lastPage = Math.min(targetPage, result.pagination?.totalPages || 1);
        for (let nextPage = 2; nextPage <= lastPage; nextPage++) {
          const next = await fetch(nextPage);
          if (requestGeneration !== generation.current) return;
          if (!next.ok) {
            setProblem(next.message);
            return;
          }
          result.data.push(...next.data);
          result.pagination = next.pagination;
        }
        targetPage = lastPage;
      }

      if (!result.ok) {
        // 追加失败时不要把已有的列表换掉（那会让用户以为数据没了），只报错。
        if (!append && !refreshLoaded)
          setState((current) => (current === "ready" ? current : "error"));
        setProblem(result.message);
        return;
      }
      setItems((current) => (append ? [...current, ...result.data] : result.data));
      setPagination(result.pagination ?? null);
      paginationRef.current = result.pagination ?? null;
      setSummary(result.summary);
      setPage(targetPage);
      pageRef.current = targetPage;
      setState("ready");
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      setState((current) => (current === "ready" ? current : "error"));
      setProblem(requestError(error).message);
    } finally {
      if (controller.current === active) controller.current = null;
      inFlight.current = false;
      appending.current = false;
      if (requestGeneration === generation.current) {
        setLoadingMore(false);
        setRefreshing(false);
      }
      completeRequest();
    }
  }, []);

  // 同步镜像：`reorder` 要在 setState 之外先拿到「改动前」的顺序用于回滚。
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const setOrder = useCallback((ids: string[]) => {
    setItems((current) => applyOrder(current, ids));
  }, []);

  const patch = useCallback((id: string, fields: Partial<T>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...fields } : item)));
  }, []);

  const reorder = useCallback((movingIds: string[], beforeId: string | null) => {
    const previous = itemsRef.current.map((item) => item.id);
    const { order } = movedManyIds(previous, movingIds, beforeId);
    if (!order) return previous;
    setItems((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      const next = order.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
      // 顺序里没有的项（并发追加的新页）接在后面，不能被丢掉。
      const known = new Set(order);
      return [...next, ...current.filter((item) => !known.has(item.id))];
    });
    return previous;
  }, []);

  const invalidate = useCallback(() => {
    const next = ++generation.current;
    queuedMore.current = null;
    paginationRef.current = null;
    controller.current?.abort();
    return next;
  }, []);
  const reload = useCallback(async () => {
    // 新筛选立即作废旧结果；在途请求结束后只执行最新一次重载，不能静默丢弃。
    const nextGeneration = invalidate();
    while (inFlight.current) await requestDone.current;
    if (nextGeneration !== generation.current) return;
    await run(1, false);
  }, [run, invalidate]);
  const refreshLoaded = useCallback(async () => {
    // 删除时可能还有追加页在途；等待完成再刷新，不能被 inFlight 静默丢弃。
    const currentGeneration = generation.current;
    while (inFlight.current) await requestDone.current;
    if (currentGeneration !== generation.current) return;
    await run(pageRef.current, false, true);
  }, [run]);

  const loadMore = useCallback(() => {
    if ((inFlight.current && appending.current) || queuedMore.current) return;
    const queued = {};
    queuedMore.current = queued;
    const requestedGeneration = generation.current;
    void (async () => {
      try {
        while (inFlight.current) await requestDone.current;
        if (requestedGeneration !== generation.current) return;
        const total = paginationRef.current?.totalPages ?? 1;
        if (pageRef.current < total) await run(pageRef.current + 1, true);
      } finally {
        if (queuedMore.current === queued) queuedMore.current = null;
      }
    })();
  }, [run]);

  useEffect(() => {
    if (options.queryKey === null) return;
    // 组件卸载后不要再 setState（例如快速切页）。
    let alive = true;
    void (async () => {
      if (alive) await reload();
    })();
    return () => {
      alive = false;
      invalidate();
    };
  }, [reload, options.queryKey, invalidate]);

  return {
    items,
    pagination,
    page,
    state,
    problem,
    loadingMore,
    refreshing,
    summary,
    reload,
    refreshLoaded,
    loadMore,
    reorder,
    setOrder,
    patch,
  };
}

/**
 * 列表末尾：显示「已加载 N / 共 M 条」，并在滚到底部时自动取下一页。
 *
 * 保留一个**手动按钮**作为兜底：筛选后结果不足一屏时不会触发滚动，
 * 此时自动加载根本不会发生，用户需要一个明确的入口（也给键盘与读屏用户一条路）。
 */
export function AdminListEnd({
  pagination,
  loaded,
  busy,
  onLoadMore,
  labels,
}: {
  pagination: PaginationMeta | null;
  loaded: number;
  busy: boolean;
  onLoadMore: () => void;
  labels: { loaded: string; all: string; more: string; loading: string };
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const hasMore = pagination !== null && pagination.total > loaded;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // 提前 400px 触发：等真正滚到底再拉，用户会看到列表停住。
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loaded, onLoadMore]);

  // 空列表不显示「已全部加载」——表格里已经写着「暂无数据」，再加一句是废话。
  if (!pagination || pagination.total === 0) return null;

  return (
    <div className="admin-listend">
      <p className="admin-listend__count" role="status" aria-live="polite">
        {hasMore
          ? labels.loaded
              .replace("{loaded}", String(loaded))
              .replace("{total}", String(pagination.total))
          : labels.all}
      </p>
      {hasMore ? (
        <>
          {/* 哨兵：进入视口（提前 400px）就自动追加下一页 */}
          <div ref={sentinel} className="admin-listend__sentinel" aria-hidden="true" />
          <button type="button" className="btn" disabled={busy} onClick={onLoadMore}>
            {busy ? labels.loading : labels.more}
          </button>
        </>
      ) : null}
    </div>
  );
}
