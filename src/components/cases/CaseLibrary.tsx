"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { casesCopy } from "@/config/cases";
import { formatDurationMinutes } from "@/config/member";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import { formatRepairParticipants, repairCopy, repairResultLabels } from "@/config/repairs";
import type { PaginationMeta, RepairCategoryView, RepairView } from "@/types/contracts";

/**
 * 成员案例库（`/member/cases`）
 *
 * 与 `/member/repairs` 的分工：那边是**可操作的记录表**（含自己的草稿 / 待审核 /
 * 已退回，能筛选状态、点进编辑），这边只读**已通过**的记录并把它们当案例翻阅 ——
 * 所以只保留「范围 / 分类 / 关键词」三个筛选项，卡片也不带任何状态动作。
 *
 * 取数复用 `GET /api/v1/repairs?status=APPROVED`（含 `isTypical` / `isDifficult` /
 * `flagged` / `categoryId` / `query` 与分页），不为它单开接口。
 *
 * 准入规则：案例库只收录**被标记**的已通过记录 ——「全部」档传
 * `flagged=any`（典型案例 ∪ 疑难案例，服务端并集），两个单标记档仍走既有的
 * `isTypical` / `isDifficult` 参数，路径与语义不变。
 */

type Scope = "ALL" | "TYPICAL" | "DIFFICULT";

/** 卡片比表格行高，一页比维修记录的 20 条少一些，减少长列表的滚动压力。 */
const PAGE_SIZE = 12;

/** 摘要长度按码点截断：正文上限 10000 字，整段铺开会把卡片撑散。 */
const SUMMARY_LENGTH = 80;

export function CaseLibrary() {
  const copy = casesCopy;
  const [items, setItems] = useState<RepairView[]>([]);
  const [categories, setCategories] = useState<RepairCategoryView[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<Scope>("ALL");
  const [categoryId, setCategoryId] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    // 只有首帧才进 loading：翻页与改筛选都保留已渲染的卡片。若这里无条件置 loading，
    // 列表会在用户点击后的下一帧被卸载，页面高度塌陷、浏览器把滚动位置夹回顶部
    // （AGENTS「交互不得夺走操控权」）。
    setState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        // 案例 = 已通过的维修记录；草稿 / 待审核 / 已退回不属于案例库。
        status: "APPROVED",
      });
      // 「全部」档 = 被标记记录的并集；单标记档参数不变。
      if (scope === "ALL") params.set("flagged", "any");
      if (scope === "TYPICAL") params.set("isTypical", "true");
      if (scope === "DIFFICULT") params.set("isDifficult", "true");
      if (categoryId) params.set("categoryId", categoryId);
      if (query) params.set("query", query);

      const response = await fetch(`/api/v1/repairs?${params}`, { cache: "no-store" });
      const json = await response.json();
      if (!json.success) throw new Error();
      setItems(json.data as RepairView[]);
      setPagination(json.meta.pagination as PaginationMeta);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [page, scope, categoryId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // 分类下拉是增强信息：取不到只少一个筛选项，不影响看案例，失败静默。
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/v1/repair-categories", { cache: "no-store" });
        const json = await response.json();
        if (json.success) setCategories(json.data as RepairCategoryView[]);
      } catch {
        /* 静默：分类不是案例库的必要条件 */
      }
    })();
  }, []);

  const scopes: readonly { key: Scope; label: string }[] = [
    { key: "ALL", label: copy.scope.all },
    { key: "TYPICAL", label: copy.scope.typical },
    { key: "DIFFICULT", label: copy.scope.difficult },
  ];
  const hasFilters = scope !== "ALL" || categoryId !== "" || query !== "";

  function changeScope(next: Scope) {
    setScope(next);
    setPage(1);
  }

  function submitSearch() {
    setQuery(queryInput.trim());
    setPage(1);
  }

  function resetFilters() {
    setQueryInput("");
    setQuery("");
    setCategoryId("");
    setScope("ALL");
    setPage(1);
  }

  return (
    <div className="community-page">
      {/* 紧凑页头：替代官网式 PageHead —— 那套在成员壳里因
          `.reveal` 特异性问题整块不可见，只剩留白。结构与 /member/rankings 一致，
          h1 的 id 由页面 section 的 aria-labelledby 引用。 */}
      <header className="cases-page__head">
        <h1 className="cases-page__title" id="member-cases-title">
          {casesCopy.title}
        </h1>
        <p className="cases-page__lead">{casesCopy.lead}</p>
      </header>

      <nav className="repair-quick-filters" aria-label={copy.scopeLabel}>
        {scopes.map((item) => (
          <Button
            className="repair-quick-filter"
            key={item.key}
            variant={scope === item.key ? "solid" : "outline"}
            onClick={() => changeScope(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      <form
        className="repair-filters"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
        aria-label={copy.filtersLabel}
      >
        <div className="repair-filters__primary">
          <label className="repair-filter repair-filter--search">
            <span className="sr-only">{copy.filters.searchLabel}</span>
            <input
              className="field__input"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={copy.filters.searchPlaceholder}
            />
          </label>
          <label className="repair-filter">
            <span className="sr-only">{copy.filters.category}</span>
            <select
              className="field__input"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{copy.filters.allCategories}</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="solid">
            {copy.filters.submit}
          </Button>
          {hasFilters ? (
            <Button type="button" variant="ghost" onClick={resetFilters}>
              {copy.filters.reset}
            </Button>
          ) : null}
        </div>
      </form>

      {/* 状态行常驻（失败时置空）：它在列表上方，出现 / 消失会把下面的卡片顶来顶去。 */}
      <p className="member-section__note" role="status" aria-live="polite">
        {state === "loading"
          ? copy.loading
          : state === "ready"
            ? copy.total.replace("{count}", String(pagination?.total ?? 0))
            : ""}
      </p>

      {state === "error" ? (
        <Card variant="notice">
          <p>{copy.loadError}</p>
          <Button onClick={() => void load()}>{copy.reload}</Button>
        </Card>
      ) : null}

      {state === "ready" && items.length === 0 ? (
        <p className="member-section__note">{hasFilters ? copy.emptyFiltered : copy.empty}</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="community-list">
          {items.map((item) => (
            <CaseCard item={item} key={item.id} />
          ))}
        </ul>
      ) : null}

      {state === "ready" && pagination && pagination.totalPages > 1 ? (
        <nav className="repair-pagination" aria-label={copy.paginationLabel}>
          <Button
            icon="chevronLeft"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            {copy.previousPage}
          </Button>
          <span>
            {page} / {pagination.totalPages}
          </span>
          <Button
            trailingIcon="chevronRight"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            {copy.nextPage}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

function CaseCard({ item }: { item: RepairView }) {
  const copy = casesCopy;
  const href = `/member/repairs/${item.id}`;
  // 摘要取值链：备注优先，老记录的维修内容回退。
  const summary = summarize(item.remark?.trim() || item.content);
  return (
    <li className="community-list__item">
      <div className="community-list__body">
        <p className="community-list__title">
          <Link href={href}>{summary ?? copy.missingContent}</Link>
        </p>
        <p className="community-list__excerpt">
          {formatShanghaiDate(item.repairDate)} · {formatRepairParticipants(item)} ·{" "}
          {item.category?.name ?? copy.uncategorized}
          {item.durationMinutes === null
            ? ""
            : ` · ${copy.durationLabel} ${formatDurationMinutes(item.durationMinutes)}`}
        </p>
        <div className="community-flags-inline">
          {item.result ? (
            <span className="member-tag">{repairResultLabels[item.result]}</span>
          ) : null}
          {item.isTypical ? <span className="member-tag">{repairCopy.list.typical}</span> : null}
          {item.isDifficult ? (
            <span className="member-tag member-tag--accent">{repairCopy.list.difficult}</span>
          ) : null}
        </div>
      </div>
      <div className="community-list__actions">
        <Button href={href} variant="ghost">
          {copy.detailAction}
        </Button>
      </div>
    </li>
  );
}

/** 正文压成一行摘要：换行与连续空白折成空格，超长按码点截断。 */
function summarize(content: string | null): string | null {
  const text = (content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH)}…` : text;
}
