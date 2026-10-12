"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { repairCopy } from "@/config/repairs";
import { parseRepairListStatus } from "@/features/repairs/repair-http";
import type {
  PaginationMeta,
  RepairCategoryView,
  RepairMemberOption,
  RepairStatus,
  RepairView,
} from "@/types/contracts";

type Props = {
  statusLabels: Record<string, string>;
  resultLabels: Record<string, string>;
};

type SummaryKey = "ALL" | "PENDING" | "DRAFT" | "REJECTED";

const initialSummary: Record<SummaryKey, number | null> = {
  ALL: null,
  PENDING: null,
  DRAFT: null,
  REJECTED: null,
};

export function RepairList({ statusLabels, resultLabels }: Props) {
  const copy = repairCopy.list;
  const [items, setItems] = useState<RepairView[]>([]);
  const [categories, setCategories] = useState<RepairCategoryView[]>([]);
  const [members, setMembers] = useState<RepairMemberOption[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>();
  const [summary, setSummary] = useState(initialSummary);
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(() => parseRepairListStatus(searchParams.get("status")));
  const [categoryId, setCategoryId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [result, setResult] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [difficult, setDifficult] = useState(false);
  const [typical, setTypical] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // 浏览器前进/后退或外链深链变化时，把 URL 白名单状态同步回本地筛选。
  useEffect(() => {
    setStatus(parseRepairListStatus(searchParams.get("status")));
  }, [searchParams]);

  const advancedFilterCount = [result, from, to, difficult, typical].filter(Boolean).length;
  const hasFilters = Boolean(query || status || categoryId || memberId || advancedFilterCount);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (query) params.set("query", query);
      if (status) params.set("status", status);
      if (categoryId) params.set("categoryId", categoryId);
      if (memberId) params.set("memberId", memberId);
      if (result) params.set("result", result);
      if (from) params.set("repairDateFrom", from);
      if (to) params.set("repairDateTo", to);
      if (difficult) params.set("isDifficult", "true");
      if (typical) params.set("isTypical", "true");

      const response = await fetch(`/api/v1/repairs?${params}`, { cache: "no-store" });
      const json = await response.json();
      if (!json.success) throw new Error();
      setItems(json.data);
      setPagination(json.meta.pagination);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [page, query, status, categoryId, memberId, result, from, to, difficult, typical]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    async function loadReferenceData() {
      try {
        const summaryRequests = (["ALL", "PENDING", "DRAFT", "REJECTED"] as const).map(
          async (key) => {
            const params = new URLSearchParams({ page: "1", pageSize: "1" });
            if (key !== "ALL") params.set("status", key);
            const response = await fetch(`/api/v1/repairs?${params}`, { cache: "no-store" });
            const json = await response.json();
            if (!json.success) throw new Error();
            return [key, json.meta.pagination.total] as const;
          },
        );
        const [categoryResponse, memberResponse, ...summaryEntries] = await Promise.all([
          fetch("/api/v1/repair-categories", { cache: "no-store" }),
          fetch("/api/v1/repair-members", { cache: "no-store" }),
          ...summaryRequests,
        ]);
        const categoryJson = await categoryResponse.json();
        const memberJson = await memberResponse.json();
        if (!categoryJson.success || !memberJson.success) throw new Error();
        setCategories(categoryJson.data);
        setMembers(memberJson.data);
        setSummary(Object.fromEntries(summaryEntries) as Record<SummaryKey, number>);
      } catch {
        setSummary(initialSummary);
      }
    }
    void loadReferenceData();
  }, []);

  const quickFilters = useMemo(
    () => [
      { key: "ALL" as const, label: copy.quickFilters.all, value: "" },
      { key: "PENDING" as const, label: copy.quickFilters.pending, value: "PENDING" },
      { key: "DRAFT" as const, label: copy.quickFilters.draft, value: "DRAFT" },
      { key: "REJECTED" as const, label: copy.quickFilters.rejected, value: "REJECTED" },
    ],
    [copy.quickFilters],
  );

  function selectStatus(nextStatus: string) {
    const normalized = nextStatus === "" ? "" : parseRepairListStatus(nextStatus);
    setStatus(normalized);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (normalized) params.set("status", normalized);
    else params.delete("status");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function submitSearch() {
    const nextQuery = queryInput.trim();
    setPage(1);
    setQuery(nextQuery);
    if (page === 1 && query === nextQuery) void load();
  }

  function resetFilters() {
    setQueryInput("");
    setQuery("");
    setCategoryId("");
    setMemberId("");
    setResult("");
    setFrom("");
    setTo("");
    setDifficult(false);
    setTypical(false);
    // 走 selectStatus 清掉 status 查询参数，保持深链可分享。
    selectStatus("");
  }

  return (
    <div className="repair-workspace__content">
      <header className="repair-workspace__header">
        <div>
          <p className="eyebrow">{copy.label}</p>
          <div className="repair-workspace__title-row">
            <h1 id="repairs-title">{copy.title}</h1>
            <span className="repair-workspace__total" aria-live="polite">
              {copy.total} {pagination?.total ?? "—"} 条
            </span>
          </div>
          <p className="repair-workspace__lead">{copy.lead}</p>
        </div>
        <Button href="/member/repairs/new" variant="solid">
          {copy.newAction}
        </Button>
      </header>

      <nav className="repair-quick-filters" aria-label="快捷状态筛选">
        {quickFilters.map((filter) => (
          <Button
            className="repair-quick-filter"
            key={filter.key}
            variant={status === filter.value ? "solid" : "outline"}
            onClick={() => selectStatus(filter.value)}
          >
            {filter.label}
            <span className="repair-quick-filter__count">{summary[filter.key] ?? "—"}</span>
          </Button>
        ))}
      </nav>

      <form
        className="repair-filters"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
        aria-label="搜索与筛选"
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
            <span className="sr-only">{copy.filters.status}</span>
            <select
              className="field__input"
              value={status}
              onChange={(event) => selectStatus(event.target.value)}
            >
              <option value="">{copy.filters.allStatuses}</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
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
          <label className="repair-filter">
            <span className="sr-only">{copy.filters.member}</span>
            <select
              className="field__input"
              value={memberId}
              onChange={(event) => {
                setMemberId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{copy.filters.allMembers}</option>
              {members.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="repair-filters__more"
            type="button"
            trailingIcon="chevronDown"
            onClick={() => setShowMore((visible) => !visible)}
            aria-label={showMore ? copy.filters.less : copy.filters.more}
          >
            {showMore ? copy.filters.less : copy.filters.more}
            {advancedFilterCount ? ` · ${advancedFilterCount}` : ""}
          </Button>
          <Button type="submit" variant="solid">
            {copy.filters.submit}
          </Button>
          {hasFilters ? (
            <Button type="button" variant="ghost" onClick={resetFilters}>
              {copy.filters.reset}
            </Button>
          ) : null}
        </div>

        {showMore ? (
          <div className="repair-filters__advanced">
            <label className="field">
              <span className="field__label">{copy.filters.result}</span>
              <select
                className="field__input"
                value={result}
                onChange={(event) => {
                  setResult(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{copy.filters.allResults}</option>
                {Object.entries(resultLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{copy.filters.dateFrom}</span>
              <input
                className="field__input"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.filters.dateTo}</span>
              <input
                className="field__input"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="repair-filters__checks">
              <label>
                <input
                  type="checkbox"
                  checked={difficult}
                  onChange={(event) => {
                    setDifficult(event.target.checked);
                    setPage(1);
                  }}
                />
                {copy.filters.difficult}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={typical}
                  onChange={(event) => {
                    setTypical(event.target.checked);
                    setPage(1);
                  }}
                />
                {copy.filters.typical}
              </label>
            </div>
          </div>
        ) : null}
      </form>

      <div className="repair-list-status" aria-live="polite">
        {state === "loading" ? <p role="status">{copy.loading}</p> : null}
        {state === "error" ? (
          <Card variant="notice">
            <p>{copy.loadError}</p>
            <Button onClick={() => void load()}>{copy.reload}</Button>
          </Card>
        ) : null}
      </div>

      {state === "ready" ? (
        <div className="repair-table-wrap">
          <table className="repair-table">
            <thead>
              <tr>
                <th>{copy.columns.date}</th>
                <th>{copy.columns.category}</th>
                <th>{copy.columns.deviceModel}</th>
                <th>{copy.columns.content}</th>
                <th>{copy.columns.member}</th>
                <th>{copy.columns.result}</th>
                <th>{copy.columns.status}</th>
                <th>
                  <span className="sr-only">{copy.columns.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <RepairRow
                  key={item.id}
                  item={item}
                  statusLabels={statusLabels}
                  resultLabels={resultLabels}
                />
              ))}
            </tbody>
          </table>
          {!items.length ? <p className="repair-table__empty">{repairCopy.empty}</p> : null}
        </div>
      ) : null}

      {pagination && pagination.totalPages > 1 ? (
        <nav className="repair-pagination" aria-label="分页">
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

function RepairRow({
  item,
  statusLabels,
  resultLabels,
}: {
  item: RepairView;
  statusLabels: Record<string, string>;
  resultLabels: Record<string, string>;
}) {
  const copy = repairCopy.list;
  return (
    <tr>
      <td data-label={copy.columns.date} className="repair-table__date">
        {formatRepairDate(item.repairDate, copy.missingDate)}
      </td>
      <td data-label={copy.columns.category}>{item.category?.name ?? copy.uncategorized}</td>
      <td data-label={copy.columns.deviceModel} className="repair-table__model">
        {item.deviceModel || copy.missingDeviceModel}
      </td>
      <td data-label={copy.columns.content} className="repair-table__content">
        {/* 摘要取值链（issue #79 第 6 项）：备注优先，老记录的维修内容回退。 */}
        <Link href={`/member/repairs/${item.id}`}>
          {item.remark?.trim() || item.content || copy.missingContent}
        </Link>
        {item.isDifficult || item.isTypical ? (
          <span className="repair-table__flags">
            {[item.isDifficult ? copy.difficult : "", item.isTypical ? copy.typical : ""]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </td>
      <td data-label={copy.columns.member}>{item.member.name}</td>
      <td data-label={copy.columns.result}>
        {item.result ? (
          <span className="repair-tag repair-tag--result">{resultLabels[item.result]}</span>
        ) : (
          <span className="repair-table__muted">{copy.missingResult}</span>
        )}
      </td>
      <td data-label={copy.columns.status}>
        <span className={`repair-tag repair-tag--${statusClass(item.status)}`}>
          {statusLabels[item.status]}
        </span>
      </td>
      <td data-label={copy.columns.action} className="repair-table__action">
        <Link href={`/member/repairs/${item.id}`}>{copy.view}</Link>
      </td>
    </tr>
  );
}

function formatRepairDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const [year, month, day] = value.split("-");
  return year === String(new Date().getFullYear()) ? `${month}-${day}` : value;
}

function statusClass(status: RepairStatus) {
  return status.toLowerCase();
}
