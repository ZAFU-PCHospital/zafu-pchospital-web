"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CommunityListSkeleton } from "@/components/community/CommunityListSkeleton";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailure } from "@/components/ui/LoadFailure";
import { PageAlert } from "@/components/ui/PageAlert";
import { useWriteAction } from "@/components/ui/useWriteAction";
import { MEMBER_NOTIFICATIONS_CHANGED_EVENT } from "@/config/member";
import { communityCopy } from "@/config/community";
import type { NotificationStatus, NotificationView, PaginationMeta } from "@/types/contracts";

export function NotificationInbox() {
  const copy = communityCopy.notifications;
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState<PaginationMeta>();
  const [filter, setFilter] = useState<"" | NotificationStatus>("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (filter) params.set("status", filter);
      const response = await fetch(`/api/v1/member/notifications?${params}`, { cache: "no-store" });
      const json = await response.json();
      if (!json.success) throw new Error();
      const data = json.data as { items: NotificationView[]; unreadCount: number };
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      setPagination(json.meta.pagination as PaginationMeta);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function notifyNavUnreadChanged() {
    window.dispatchEvent(new CustomEvent(MEMBER_NOTIFICATIONS_CHANGED_EVENT));
  }

  const write = useWriteAction({
    onSuccess: async () => {
      await load();
      notifyNavUnreadChanged();
    },
  });

  async function markRead(id: string) {
    await write.run(
      `read:${id}`,
      async () => {
        const response = await fetch(`/api/v1/member/notifications/${id}/read`, {
          method: "POST",
        });
        const json = await response.json();
        return json.success ? { ok: true } : { ok: false, message: json.error?.message };
      },
      copy.markReadFailed,
    );
  }

  async function markAll() {
    await write.run(
      "all",
      async () => {
        const response = await fetch("/api/v1/member/notifications/read-all", { method: "POST" });
        const json = await response.json();
        return json.success ? { ok: true } : { ok: false, message: json.error?.message };
      },
      copy.markAllFailed,
    );
  }

  async function remove(id: string) {
    await write.run(
      `delete:${id}`,
      async () => {
        const response = await fetch(`/api/v1/member/notifications/${id}`, {
          method: "DELETE",
        });
        const json = await response.json();
        return json.success ? { ok: true } : { ok: false, message: json.error?.message };
      },
      copy.deleteFailed,
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
      <div className="community-toolbar">
        <div className="community-toolbar__filters">
          {(
            [
              ["", copy.filterAll],
              ["UNREAD", copy.filterUnread],
              ["READ", copy.filterRead],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value || "all"}
              type="button"
              variant={filter === value ? "solid" : "outline"}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          onClick={() => void markAll()}
          disabled={unreadCount === 0 || write.busy}
        >
          {write.busyKey === "all" ? copy.marking : copy.markAllRead}
        </Button>
      </div>
      <p className="community-block__meta">
        {copy.unreadCount.replace("{count}", String(unreadCount))}
      </p>
      {state === "loading" ? <CommunityListSkeleton label={copy.loading} /> : null}
      {state === "ready" && items.length === 0 ? (
        <EmptyState
          title={
            filter === "UNREAD" ? copy.unreadEmpty : filter === "READ" ? copy.readEmpty : copy.empty
          }
          action={
            filter ? (
              <Button
                onClick={() => {
                  setFilter("");
                  setPage(1);
                }}
              >
                {copy.filterAll}
              </Button>
            ) : (
              <Button onClick={() => void load()}>{copy.reload}</Button>
            )
          }
        />
      ) : null}
      <ul className="community-list">
        {items.map((item) => (
          <li
            className={`community-list__item ${item.status === "UNREAD" ? "is-unread" : ""}`}
            key={item.id}
          >
            <NotificationRow item={item} />
            <div className="community-list__actions">
              {item.status === "UNREAD" ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={write.busy}
                  onClick={() => void markRead(item.id)}
                >
                  {write.busyKey === `read:${item.id}` ? copy.marking : copy.markRead}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={write.busy}
                onClick={() => void remove(item.id)}
              >
                {write.busyKey === `delete:${item.id}` ? copy.marking : copy.delete}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {pagination && pagination.totalPages > 1 ? (
        <nav className="repair-pagination">
          <Button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
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

export function NotificationRow({ item }: { item: NotificationView }) {
  const copy = communityCopy.notifications;
  const href = item.repairRecordId ? `/member/repairs/${item.repairRecordId}` : undefined;
  return (
    <div className="community-list__body">
      <p className="community-list__title">
        {item.actor ? `${item.actor.name} ` : ""}
        {copy.types[item.type] ?? item.type}
      </p>
      {item.repairExcerpt ? <p className="community-list__excerpt">{item.repairExcerpt}</p> : null}
      <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
      {href ? (
        <p>
          <Link href={href}>{communityCopy.favorites.open}</Link>
        </p>
      ) : null}
    </div>
  );
}
