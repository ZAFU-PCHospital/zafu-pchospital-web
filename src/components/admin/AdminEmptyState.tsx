"use client";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { adminShared } from "@/config/admin";

/** 后台列表空态：筛选无结果时先清除筛选，否则提供刷新。 */
export function AdminEmptyState({
  filtered,
  busy,
  onClearFilters,
  onReload,
}: {
  filtered: boolean;
  busy: boolean;
  onClearFilters?: () => void;
  onReload: () => void;
}) {
  return (
    <EmptyState
      title={filtered ? adminShared.emptyFiltered : adminShared.empty}
      description={adminShared.emptyHint}
      action={
        filtered && onClearFilters ? (
          <Button onClick={onClearFilters}>{adminShared.clearFilters}</Button>
        ) : (
          <Button onClick={onReload} disabled={busy}>
            {adminShared.reload}
          </Button>
        )
      }
    />
  );
}
