"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { AdminFilterDialog } from "@/components/admin/AdminFilterDialog";
import { AdminModal } from "@/components/admin/AdminModal";
import { Button } from "@/components/ui/Button";
import { adminShared } from "@/config/admin";
import { tableCopy } from "@/config/admin-tables";
import { tableField, tableSortLabel, type TableQueryOptions } from "@/config/table-queries";
import type { TableQueryState } from "@/lib/table/query-state";
import {
  applyQuickFields,
  clearFilterConditions,
  removeAdvancedFilter,
  splitQuickFields,
  withFixedValue,
  type QuickField,
  type StatusTabs,
} from "@/lib/table/quick-query";
import type { SortRule, TableGroupSummary } from "@/types/table";

export type TableQuickField = QuickField;
export type TableStatusTabs = StatusTabs;

type ConditionChip = {
  key: string;
  text: string;
  onRemove: () => void;
};

/**
 * 后台列表查询工具栏（方案 D）。
 *
 * 状态页签直接切换最常用的状态字段；关键字默认收起，更多筛选只放其余快捷字段，
 * 高级条件、排序与分组仍走原有弹层。这样首屏先看到列表，条件和摘要也不会因收起而消失。
 * 条件 chips 一律来自已提交查询，输入中的草稿不会进入摘要。
 */
export function AdminTableQuery<F extends Record<string, string>>({
  value,
  options,
  quick,
  statusTabs,
  onChange,
  onClear,
  summary,
  refreshing,
  onResetColumns,
  ready = true,
  problem,
}: {
  value: TableQueryState<F>;
  options: TableQueryOptions;
  quick: readonly QuickField[];
  statusTabs?: TableStatusTabs;
  onChange: (value: TableQueryState<F>) => void;
  onClear: () => void;
  summary?: TableGroupSummary;
  refreshing: boolean;
  onResetColumns?: () => void;
  ready?: boolean;
  problem?: string;
}) {
  const { search, fields: moreFields } = splitQuickFields(quick, statusTabs?.key);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAllConditions, setShowAllConditions] = useState(false);
  const [condition, setCondition] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() =>
    search ? (value.fixed[search.key] ?? "") : "",
  );
  const composing = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const searchPanelId = useId();
  const committedSearch = search ? (value.fixed[search.key] ?? "") : "";
  const committedSearchRef = useRef(committedSearch);

  useEffect(() => {
    if (committedSearchRef.current === committedSearch) return;
    committedSearchRef.current = committedSearch;
    setSearchDraft(committedSearch);
  }, [committedSearch]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const quickChips: ConditionChip[] = quick.flatMap((field) => {
    const raw = value.fixed[field.key];
    if (!raw) return [];
    const label = field.key === "query" ? tableField(options.id, "query").label : field.label;
    const shown = field.options?.find((option) => option.value === raw)?.label ?? raw;
    return [
      {
        key: `quick:${field.key}`,
        text: `${label}：${shown}`,
        onRemove: () => onChange(withFixedValue(value, field.key, "")),
      },
    ];
  });
  // 深链可能带回未出现在快捷字段里的枚举（如维修结果），也要在摘要里可见、可移除。
  const quickKeys = new Set(quick.map((field) => field.key));
  const extraChips: ConditionChip[] = Object.entries(value.fixed).flatMap(([key, raw]) => {
    if (!raw || quickKeys.has(key)) return [];
    const field = tableField(options.id, key);
    return [
      {
        key: `fixed:${key}`,
        text: `${field.label}：${field.labels?.[raw] ?? raw}`,
        onRemove: () => onChange(withFixedValue(value, key, "")),
      },
    ];
  });
  const filterChips: ConditionChip[] = value.filters.map((rule, index) => {
    const field = tableField(options.id, rule.field);
    return {
      key: `filter:${index}:${rule.field}`,
      text: `${field.label} ${adminShared.filters.ops[rule.op]} ${
        field.labels?.[rule.value] ?? rule.value
      }`,
      onRemove: () => onChange(removeAdvancedFilter(value, index)),
    };
  });
  const conditions = [...quickChips, ...extraChips, ...filterChips];
  const hiddenCount = conditions.length - 3;
  const visibleConditions = showAllConditions ? conditions : conditions.slice(0, 3);
  const hasMeta = conditions.length > 0 || value.sort.length > 0 || Boolean(value.groupBy);

  function closeSearch() {
    setSearchOpen(false);
    searchToggle.current?.focus();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search || composing.current) return;
    const next = searchDraft.trim();
    setSearchDraft(next);
    onChange(withFixedValue(value, search.key, next));
  }

  return (
    <div className="admin-query">
      <form
        method="post"
        className="admin-query__form"
        aria-label={tableCopy.query}
        onSubmit={submitSearch}
      >
        <fieldset className="admin-query__fieldset" disabled={!ready}>
          <div className="admin-query__toolbar">
            {statusTabs ? (
              <>
                <div className="admin-query__tabs" role="group" aria-label={statusTabs.label}>
                  {[{ value: "", label: tableCopy.all }, ...statusTabs.options].map((tab) => (
                    <button
                      key={tab.value || "all"}
                      type="button"
                      className="admin-query__tab"
                      aria-pressed={(value.fixed[statusTabs.key] ?? "") === tab.value}
                      onClick={() => onChange(withFixedValue(value, statusTabs.key, tab.value))}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <label className="field admin-query__status">
                  <span className="field__label">{statusTabs.label}</span>
                  <select
                    className="field__input"
                    value={value.fixed[statusTabs.key] ?? ""}
                    onChange={(event) =>
                      onChange(withFixedValue(value, statusTabs.key, event.target.value))
                    }
                  >
                    <option value="">{tableCopy.all}</option>
                    {statusTabs.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            <div className="admin-query__actions">
              {search ? (
                <button
                  ref={searchToggle}
                  type="button"
                  className="btn btn--ghost admin-query__toggle"
                  aria-expanded={searchOpen}
                  aria-controls={searchPanelId}
                  onClick={() => setSearchOpen((open) => !open)}
                >
                  <span>{tableCopy.search}</span>
                </button>
              ) : null}
              {moreFields.length > 0 ? (
                <Button variant="ghost" icon="filter" onClick={() => setMoreOpen(true)}>
                  {tableCopy.more}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setAdvancedOpen(true)}>
                {tableCopy.advancedShort}
              </Button>
            </div>
          </div>

          {search ? (
            <div className="admin-query__search" id={searchPanelId} hidden={!searchOpen}>
              <label className="field">
                <span className="sr-only">{search.label}</span>
                <input
                  ref={searchInput}
                  className="field__input"
                  name={search.key}
                  value={searchDraft}
                  maxLength={search.maxLength ?? 64}
                  placeholder={search.placeholder ?? search.label}
                  autoComplete="off"
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeSearch();
                    } else if (
                      event.key === "Enter" &&
                      (composing.current || event.nativeEvent.isComposing)
                    ) {
                      event.preventDefault();
                    }
                  }}
                />
              </label>
              <Button type="submit">{tableCopy.search}</Button>
            </div>
          ) : null}
        </fieldset>
      </form>

      {conditions.length > 0 ? (
        <div className="admin-query__chips" role="group" aria-label={tableCopy.activeConditions}>
          {visibleConditions.map((chip) => (
            <span className="admin-query__chip" key={chip.key}>
              <button
                type="button"
                className="admin-query__chip-value"
                aria-label={`${tableCopy.viewCondition} ${chip.text}`}
                onClick={() => setCondition(chip.text)}
              >
                {chip.text}
              </button>
              <button
                type="button"
                className="admin-query__chip-remove"
                aria-label={`${tableCopy.remove} ${chip.text}`}
                onClick={chip.onRemove}
              >
                ×
              </button>
            </span>
          ))}
          {hiddenCount > 0 ? (
            <Button variant="ghost" onClick={() => setShowAllConditions(!showAllConditions)}>
              {showAllConditions
                ? tableCopy.collapseConditions
                : tableCopy.moreConditions.replace("{count}", String(hiddenCount))}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="admin-query__clearfilters"
            onClick={() => onChange(clearFilterConditions(value))}
          >
            {tableCopy.clearFilters}
          </Button>
        </div>
      ) : null}

      {hasMeta ? (
        <div className="admin-query__meta">
          {value.sort.length > 0 ? (
            <>
              <span>{tableCopy.sort}：</span>
              {value.sort.map((rule, index) => (
                <Button
                  key={rule.field}
                  variant="ghost"
                  aria-label={`${tableCopy.remove} ${tableSortLabel(
                    options.id,
                    rule.field,
                  )} ${tableCopy.sort}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      sort: value.sort.filter((_, current) => current !== index),
                    })
                  }
                >
                  {index + 1}. {tableSortLabel(options.id, rule.field)}{" "}
                  {rule.direction === "asc" ? "↑" : "↓"} ×
                </Button>
              ))}
            </>
          ) : null}
          {value.groupBy ? (
            <Button variant="ghost" onClick={() => setAdvancedOpen(true)}>
              {tableCopy.group}：{tableField(options.id, value.groupBy).label}
            </Button>
          ) : null}
          <Button variant="ghost" className="admin-query__reset" onClick={onClear}>
            {tableCopy.clear}
          </Button>
        </div>
      ) : null}

      {moreOpen ? (
        <QuickFiltersDialog
          fields={moreFields}
          value={value}
          onApply={(values) => {
            onChange(applyQuickFields(value, moreFields, values));
            setMoreOpen(false);
          }}
          onClose={() => setMoreOpen(false)}
        />
      ) : null}

      {advancedOpen ? (
        <QueryDialog
          value={value}
          options={options}
          summary={summary}
          refreshing={refreshing}
          problem={problem}
          onChange={onChange}
          onClose={() => setAdvancedOpen(false)}
          onResetColumns={onResetColumns}
        />
      ) : null}

      {condition !== null ? (
        <AdminModal
          title={tableCopy.conditionTitle}
          size="compact"
          onClose={() => setCondition(null)}
        >
          <p className="admin-query__condition">{condition}</p>
        </AdminModal>
      ) : null}
    </div>
  );
}

function QuickFiltersDialog<F extends Record<string, string>>({
  fields,
  value,
  onApply,
  onClose,
}: {
  fields: readonly QuickField[];
  value: TableQueryState<F>;
  onApply: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) initial[field.key] = value.fixed[field.key] ?? "";
    return initial;
  });

  return (
    <AdminModal title={tableCopy.more} size="compact" onClose={onClose}>
      <form
        className="admin-query__editor"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
      >
        {fields.map((field) => (
          <label className="field" key={field.key}>
            <span className="field__label">{field.label}</span>
            {field.options ? (
              <select
                className="field__input"
                value={draft[field.key] ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
              >
                <option value="">{tableCopy.all}</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field__input"
                value={draft[field.key] ?? ""}
                maxLength={field.maxLength ?? 64}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            )}
          </label>
        ))}
        <div className="admin-actions">
          <Button type="submit" variant="solid" icon="check">
            {adminShared.filters.apply}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {adminShared.cancel}
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}

function QueryDialog<F extends Record<string, string>>({
  value,
  options,
  onChange,
  onClose,
  summary,
  refreshing,
  onResetColumns,
  problem,
}: {
  value: TableQueryState<F>;
  options: TableQueryOptions;
  onChange: (value: TableQueryState<F>) => void;
  onClose: () => void;
  summary?: TableGroupSummary;
  refreshing: boolean;
  onResetColumns?: () => void;
  problem?: string;
}) {
  const [sort, setSort] = useState<SortRule[]>(value.sort);
  const [groupBy, setGroupBy] = useState(value.groupBy);

  return (
    <AdminFilterDialog
      title={tableCopy.advanced}
      fields={options.filters}
      rules={value.filters}
      onClose={onClose}
      keepOpenOnApply={Boolean(groupBy)}
      onApply={(filters) => onChange({ ...value, filters, sort, groupBy })}
    >
      <section className="admin-query__section" aria-label={tableCopy.sort}>
        <h3>{tableCopy.sort}</h3>
        <p className="admin-conditions__hint">{tableCopy.sortHint}</p>
        {sort.map((rule, index) => (
          <div className="admin-query__sortrow" key={index}>
            <label className="field">
              <span className="field__label">
                {index + 1}. {adminShared.filters.field}
              </span>
              <select
                className="field__input"
                value={rule.field}
                onChange={(event) =>
                  setSort(
                    sort.map((entry, i) =>
                      i === index ? { ...entry, field: event.target.value } : entry,
                    ),
                  )
                }
              >
                {options.sortable.map((field) => (
                  <option
                    key={field}
                    value={field}
                    disabled={field !== rule.field && sort.some((entry) => entry.field === field)}
                  >
                    {tableSortLabel(options.id, field)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{tableCopy.sort}</span>
              <select
                className="field__input"
                value={rule.direction}
                onChange={(event) =>
                  setSort(
                    sort.map((entry, i) =>
                      i === index
                        ? { ...entry, direction: event.target.value as SortRule["direction"] }
                        : entry,
                    ),
                  )
                }
              >
                <option value="asc">{tableCopy.sortAsc}</option>
                <option value="desc">{tableCopy.sortDesc}</option>
              </select>
            </label>
            <Button variant="ghost" onClick={() => setSort(sort.filter((_, i) => i !== index))}>
              {tableCopy.remove}
            </Button>
          </div>
        ))}
        <Button
          disabled={sort.length >= 3 || sort.length >= options.sortable.length}
          onClick={() => {
            const field = options.sortable.find(
              (field) => !sort.some((rule) => rule.field === field),
            );
            if (field) setSort([...sort, { field, direction: "asc" }]);
          }}
        >
          {adminShared.filters.add}
        </Button>
        {onResetColumns ? (
          <Button variant="ghost" onClick={onResetColumns}>
            {tableCopy.restoreColumns}
          </Button>
        ) : null}
      </section>
      <section className="admin-query__section" aria-label={tableCopy.group}>
        <label className="field">
          <span className="field__label">{tableCopy.group}</span>
          <select
            className="field__input"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value)}
          >
            <option value="">{tableCopy.groupNone}</option>
            {options.groups.map((field) => (
              <option key={field} value={field}>
                {tableField(options.id, field).label}
              </option>
            ))}
          </select>
        </label>
        <p className="admin-conditions__hint">{tableCopy.groupHint}</p>
        {problem ? (
          <p className="admin-status admin-status--error" role="alert">
            {problem}
          </p>
        ) : refreshing ? (
          <p role="status">{tableCopy.updating}</p>
        ) : groupBy && summary?.field === groupBy ? (
          <dl className="admin-query__groups" aria-busy={refreshing}>
            {summary.counts.map((entry) => (
              <div key={entry.value ?? "null"}>
                <dt>
                  {entry.value === null
                    ? adminShared.none
                    : (tableField(options.id, groupBy).labels?.[entry.value] ?? entry.value)}
                </dt>
                <dd>{entry.count}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
    </AdminFilterDialog>
  );
}
