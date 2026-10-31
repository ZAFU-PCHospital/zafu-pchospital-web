"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActivityTicketCard,
  type ActivityTicketCopy,
} from "@/components/repair-activities/ActivityTicketCard";
import { Button } from "@/components/ui/Button";
import { repairActivitiesPage } from "@/config/repair-activities";
import type { RepairActivityPublicView } from "@/features/repair-activities/repair-activity-service";
import type { PaginationMeta } from "@/types/contracts";

const PAGE_SIZE = 4;
const TICKET_COPY: ActivityTicketCopy = {
  activityAt: repairActivitiesPage.activityAt,
  capacity: repairActivitiesPage.capacity,
  remainingShort: repairActivitiesPage.remainingShort,
  endedHint: repairActivitiesPage.endedHint,
};

type PublicActivityListResponse = {
  success: boolean;
  data?: RepairActivityPublicView[];
  meta?: { pagination?: PaginationMeta };
  error?: { message?: string };
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
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const loadPage = useCallback(async (requestedPage: number, mode: "initial" | "page") => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (mode === "initial") {
      setState("loading");
      setMessage("");
    } else {
      setLoadingPage(requestedPage);
      setPageMessage("");
    }

    let targetPage = Math.max(1, requestedPage);
    let lastPayload: PublicActivityListResponse | null = null;
    try {
      // 翻页途中活动可能减少：若服务端总页数变小，改取最后一页而不是停在越界页。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(pageUrl(targetPage), {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PublicActivityListResponse;
        if (requestId !== requestSequence.current) return;
        lastPayload = payload;
        if (!response.ok || !payload.success || !Array.isArray(payload.data)) break;
        const nextPagination = payload.meta?.pagination;
        if (!nextPagination) break;
        const nextTotalPages = Math.max(1, nextPagination.totalPages);
        if (targetPage <= nextTotalPages) {
          setItems(payload.data);
          setTotalPages(nextTotalPages);
          setPage(targetPage);
          setState("ready");
          setPageMessage("");
          if (mode === "page" && typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => {
              listRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
            });
          }
          return;
        }
        targetPage = nextTotalPages;
      }

      const fallback =
        mode === "initial"
          ? repairActivitiesPage.loadFailed
          : formatPageCopy(repairActivitiesPage.pageLoadFailed, requestedPage);
      const nextMessage =
        lastPayload && !lastPayload.success ? (lastPayload.error?.message ?? fallback) : fallback;
      if (mode === "initial") {
        setState("error");
        setMessage(nextMessage);
      } else {
        setPageMessage(nextMessage);
      }
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
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
    } finally {
      if (requestId === requestSequence.current) {
        setLoadingPage(null);
        requestController.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void loadPage(1, "initial");
    return () => {
      requestSequence.current += 1;
      requestController.current?.abort();
    };
  }, [loadPage]);

  const safePage = Math.min(page, totalPages);

  if (state === "loading") {
    return <p className="muted">正在加载活动…</p>;
  }
  if (state === "error") {
    return (
      <p className="admin-status admin-status--error" role="alert">
        {message}
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="muted">{repairActivitiesPage.empty}</p>;
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
      {busy ? (
        <p className="muted" role="status" aria-live="polite">
          {formatPageCopy(repairActivitiesPage.loadingPage, loadingPage ?? safePage)}
        </p>
      ) : null}
      {pageMessage ? (
        <p className="admin-status admin-status--error" role="alert">
          {pageMessage}
        </p>
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
