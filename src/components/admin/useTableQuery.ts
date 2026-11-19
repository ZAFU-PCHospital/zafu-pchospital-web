"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TableQueryOptions } from "@/config/table-queries";
import {
  emptyTableQuery,
  readTableParams,
  shareableTableParams,
  tableRequestParams,
  type TableQueryState,
} from "@/lib/table/query-state";
import type { SortRule } from "@/types/table";

export function useTableQuery<F extends Record<string, string>>(
  options: TableQueryOptions,
  defaults: F,
) {
  const [value, setValue] = useState<TableQueryState<F>>(() => emptyTableQuery(defaults));
  const [ready, setReady] = useState(false);
  const skipUrl = useRef(false);
  useEffect(() => {
    const restore = () => {
      skipUrl.current = true;
      setValue(readTableParams(new URLSearchParams(window.location.search), defaults, options));
      setReady(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [defaults, options]);
  useEffect(() => {
    if (!ready) return;
    const search = shareableTableParams(value, options).toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    if (skipUrl.current) {
      skipUrl.current = false;
      window.history.replaceState(window.history.state, "", url);
    } else if (
      `${window.location.pathname}${window.location.search}${window.location.hash}` !== url
    ) {
      // 筛选/排序是同一张列表的局部状态，替换当前历史项即可；
      // 连续改条件不应要求用户按多次 Back 才离开页面。深链与刷新仍从 URL 恢复。
      window.history.replaceState(window.history.state, "", url);
    }
  }, [value, options, ready]);
  const setFixed = useCallback((fixed: F) => setValue((current) => ({ ...current, fixed })), []);
  const setSort = useCallback(
    (sort: SortRule[]) => setValue((current) => ({ ...current, sort })),
    [],
  );
  const reset = useCallback(() => setValue(emptyTableQuery(defaults)), [defaults]);
  const params = useCallback((page: number) => tableRequestParams(value, page), [value]);
  return {
    value,
    setValue,
    setFixed,
    setSort,
    reset,
    params,
    ready,
    signature: JSON.stringify(value),
  };
}
