"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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

  async function remove(repairRecordId: string) {
    const response = await fetch(`/api/v1/member/favorites/${repairRecordId}`, { method: "DELETE" });
    const json = await response.json();
    if (json.success) await load();
  }

  if (state === "error") {
    return (
      <Card variant="notice">
        <p>{copy.loadError}</p>
        <Button onClick={() => void load()}>{copy.reload}</Button>
      </Card>
    );
  }

  return (
    <div className="community-page">
      {state === "loading" ? <p role="status">{copy.loading}</p> : null}
      {state === "ready" && items.length === 0 ? <p className="member-section__note">{copy.empty}</p> : null}
      <ul className="community-list">
        {items.map((item) => (
          <li className="community-list__item" key={item.id}>
            <FavoriteRow item={item} />
            <div className="community-list__actions">
              <Button type="button" variant="ghost" onClick={() => void remove(item.repairRecordId)}>
                {copy.remove}
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
