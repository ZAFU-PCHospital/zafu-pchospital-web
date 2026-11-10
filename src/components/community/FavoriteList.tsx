"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CommunityListSkeleton } from "@/components/community/CommunityListSkeleton";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailure } from "@/components/ui/LoadFailure";
import { PageAlert } from "@/components/ui/PageAlert";
import { useWriteAction } from "@/components/ui/useWriteAction";
import { communityCopy } from "@/config/community";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import { repairCopy } from "@/config/repairs";
import type { FavoriteView, PaginationMeta } from "@/types/contracts";

export function FavoriteList() {
  const copy = communityCopy.favorites;
  const [items, setItems] = useState<FavoriteView[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      const response = await fetch(`/api/v1/member/favorites?${params}`, { cache: "no-store" });
      const json = await response.json();
      if (!json.success) throw new Error();
      setItems(json.data as FavoriteView[]);
      setPagination(json.meta.pagination as PaginationMeta);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const write = useWriteAction({ onSuccess: load });

  async function remove(repairRecordId: string) {
    await write.run(
      `favorite:${repairRecordId}`,
      async () => {
        const response = await fetch(`/api/v1/member/favorites/${repairRecordId}`, {
          method: "DELETE",
        });
        const json = await response.json();
        return json.success ? { ok: true } : { ok: false, message: json.error?.message };
      },
      copy.removeFailed,
    );
  }

  if (state === "error") {
    return (
      <LoadFailure message={copy.loadError} retryLabel={copy.reload} onRetry={() => void load()} />
    );
  }

  return (
    <div className="community-page">
      {write.error ? (
        <PageAlert
          message={write.error}
          closeLabel={communityCopy.common.dismiss}
          onClose={write.clearError}
        />
      ) : null}
      {state === "loading" ? <CommunityListSkeleton label={copy.loading} /> : null}
      {state === "ready" && items.length === 0 ? (
        <EmptyState
          title={copy.empty}
          action={<Button href="/member/repairs">{copy.browseRepairs}</Button>}
        />
      ) : null}
      <ul className="community-list">
        {items.map((item) => (
          <li className="community-list__item" key={item.id}>
            <FavoriteRow item={item} />
            <div className="community-list__actions">
              <Button
                type="button"
                variant="ghost"
                disabled={write.busy}
                onClick={() => void remove(item.repairRecordId)}
              >
                {write.busyKey === `favorite:${item.repairRecordId}`
                  ? communityCopy.favorite.removing
                  : copy.remove}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {pagination && pagination.totalPages > 1 ? (
        <nav className="repair-pagination">
          <Button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            {communityCopy.pagination.previous}
          </Button>
          <span>
            {page} / {pagination.totalPages}
          </span>
          <Button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            {communityCopy.pagination.next}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

export function FavoriteRow({ item }: { item: FavoriteView }) {
  return (
    <div className="community-list__body">
      <p className="community-list__title">
        <Link href={`/member/repairs/${item.repairRecordId}`}>{item.contentExcerpt}</Link>
      </p>
      <p className="community-list__excerpt">
        {formatShanghaiDate(item.repairDate)} · {item.memberName}
        {item.categoryName ? ` · ${item.categoryName}` : ""}
      </p>
      <div className="community-flags-inline">
        {item.isDifficult ? <span className="member-tag member-tag--accent">{repairCopy.list.difficult}</span> : null}
        {item.isTypical ? <span className="member-tag">{repairCopy.list.typical}</span> : null}
      </div>
    </div>
  );
}
