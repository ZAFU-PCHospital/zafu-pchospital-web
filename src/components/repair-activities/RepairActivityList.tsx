"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActivityTicketCard,
  type ActivityTicketCopy,
} from "@/components/repair-activities/ActivityTicketCard";
import { ActivityListSkeleton } from "@/components/repair-activities/ActivityListSkeleton";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailure } from "@/components/ui/LoadFailure";
import { PageAlert } from "@/components/ui/PageAlert";
import { repairActivitiesPage } from "@/config/repair-activities";
import type { RepairActivityPublicView } from "@/features/repair-activities/repair-activity-service";
import { createLatestRequest } from "@/lib/client/latest-request";
import { requestError, requestJson } from "@/lib/client/request";

const PAGE_SIZE = 4;
const TICKET_COPY: ActivityTicketCopy = {
  activityAt: repairActivitiesPage.activityAt,
  location: repairActivitiesPage.location,
  capacity: repairActivitiesPage.capacity,
  remainingShort: repairActivitiesPage.remainingShort,
  endedHint: repairActivitiesPage.endedHint,
};

function pageUrl(page: number): string {
  return `/api/v1/repair-activities?page=${page}&pageSize=${PAGE_SIZE}`;
}

function formatPageCopy(template: string, page: number): string {
  return template.replace("{page}", String(page));
}

export function RepairActivityList() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<RepairActivityPublicView[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [message, setMessage] = useState("");
  const [loadingPage, setLoadingPage] = useState<number | null>(null);
  const [pageMessage, setPageMessage] = useState("");
  const requests = useRef(createLatestRequest());
  const listRef = useRef<HTMLUListElement | null>(null);

  const loadPage = useCallback(async (requestedPage: number, mode: "initial" | "page") => {
    const request = requests.current.begin();
    if (mode === "initial") {
      setState("loading");
      setMessage("");
    } else {
      // 末页较少或卡片较矮时，保留当前高度，避免分页和下方内容上移。
      const list = listRef.current;
      if (list) list.style.minHeight = `${list.getBoundingClientRect().height}px`;
      setLoadingPage(requestedPage);
      setPageMessage("");
    }

    let targetPage = Math.max(1, requestedPage);
    try {
      // 翻页途中活动可能减少：若服务端总页数变小，改取最后一页而不是停在越界页。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const payload = await requestJson<RepairActivityPublicView[]>(pageUrl(targetPage), {
          cache: "no-store",
          signal: request.signal,
        });
        if (!request.isCurrent()) return;
        if (!Array.isArray(payload.data)) break;
        const nextPagination = payload.meta?.pagination;
        if (!nextPagination) break;
        const nextTotalPages = Math.max(1, nextPagination.totalPages);
        if (targetPage <= nextTotalPages) {
          setItems(payload.data);
          setTotalPages(nextTotalPages);
          setPage(targetPage);
          setState("ready");
          setPageMessage("");
          return;
        }
        targetPage = nextTotalPages;
      }

      const fallback =
        mode === "initial"
          ? repairActivitiesPage.loadFailed
          : formatPageCopy(repairActivitiesPage.pageLoadFailed, requestedPage);
      if (mode === "initial") {
        setState("error");
        setMessage(fallback);
      } else {
        setPageMessage(fallback);
      }
    } catch (error) {
      if (!request.isCurrent()) return;
      const failure = requestError(error);
      if (failure.code === "REQUEST_ABORTED") return;
      const fallback =
        mode === "initial"
          ? repairActivitiesPage.loadFailed
          : formatPageCopy(repairActivitiesPage.pageLoadFailed, requestedPage);
      if (mode === "initial") {
        setState("error");
        setMessage(failure.code === "NETWORK_ERROR" ? fallback : failure.message);
      } else {
        setPageMessage(failure.code === "NETWORK_ERROR" ? fallback : failure.message);
      }
    } finally {
      if (request.isCurrent()) {
        setLoadingPage(null);
      }
      request.finish();
    }
  }, []);

  useEffect(() => {
    const scope = requests.current;
    void loadPage(1, "initial");
    // 宽度改变后按新的卡片列数重新布局。
    let width = typeof window === "undefined" ? 0 : window.innerWidth;
    const resetListHeight = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      if (listRef.current) listRef.current.style.minHeight = "";
    };
    if (typeof window !== "undefined") window.addEventListener("resize", resetListHeight);
    return () => {
      scope.invalidate();
      if (typeof window !== "undefined") window.removeEventListener("resize", resetListHeight);
    };
  }, [loadPage]);

  const safePage = Math.min(page, totalPages);

  if (state === "loading") {
    return <ActivityListSkeleton />;
  }
  if (state === "error") {
    return (
      <LoadFailure
        message={message}
        retryLabel={repairActivitiesPage.reload}
        onRetry={() => loadPage(1, "initial")}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={repairActivitiesPage.empty}
        action={
          <Button onClick={() => void loadPage(1, "initial")}>{repairActivitiesPage.reload}</Button>
        }
      />
    );
  }

  const busy = loadingPage !== null;
  const goToPage = (targetPage: number) => {
    if (busy) return;
    const nextPage = Math.min(Math.max(1, targetPage), totalPages);
    if (nextPage === safePage) return;
    void loadPage(nextPage, "page");
  };

  return (
    <div className="activity-list-block">
      <ul
        ref={listRef}
        className="activity-list activity-list--paged activity-list--ticket"
        aria-busy={busy}
      >
        {items.map((item) => (
          <li key={item.id}>
            <ActivityTicketCard activity={item} copy={TICKET_COPY} />
          </li>
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? formatPageCopy(repairActivitiesPage.loadingPage, loadingPage ?? safePage) : ""}
      </p>
      {pageMessage ? (
        <PageAlert
          message={pageMessage}
          closeLabel={repairActivitiesPage.detail.dismissError}
          onClose={() => setPageMessage("")}
        />
      ) : null}
      {totalPages > 1 ? (
        <nav className="repair-pagination" aria-label={repairActivitiesPage.paginationLabel}>
          <Button
            type="button"
            icon="chevronLeft"
            disabled={busy || safePage <= 1}
            onClick={() => goToPage(safePage - 1)}
          >
            {repairActivitiesPage.previousPage}
          </Button>
          <span aria-live="polite">
            {safePage} / {totalPages}
          </span>
          <Button
            type="button"
            trailingIcon="chevronRight"
            disabled={busy || safePage >= totalPages}
            onClick={() => goToPage(safePage + 1)}
          >
            {repairActivitiesPage.nextPage}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
