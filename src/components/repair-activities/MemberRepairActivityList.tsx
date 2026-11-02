"use client";

import { useEffect, useState } from "react";

import { MemberRepairActivityTicketCard } from "@/components/repair-activities/MemberRepairActivityTicketCard";
import { memberRepairActivitiesCopy } from "@/config/repair-activities";
import type { StaffActivityListItem } from "@/features/repair-activities/repair-activity-staff-service";

export function MemberRepairActivityList() {
  const copy = memberRepairActivitiesCopy.list;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<StaffActivityListItem[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/v1/member/repair-activities", { cache: "no-store" });
        const json = (await response.json()) as {
          success: boolean;
          data?: StaffActivityListItem[];
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!json.success || !json.data) {
          setState("error");
          setMessage(json.error?.message ?? copy.loadFailed);
          return;
        }
        setItems(
          [...json.data].sort(
            (a, b) => new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime(),
          ),
        );
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("error");
          setMessage(copy.loadFailed);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [copy.loadFailed]);

  if (state === "loading") {
    return <p className="muted">正在加载…</p>;
  }
  if (state === "error") {
    return (
      <p className="admin-status admin-status--error" role="alert">
        {message}
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="muted">{copy.empty}</p>;
  }

  return (
    <ul className="activity-list activity-list--ticket">
      {items.map((item) => (
        <li key={item.id}>
          <MemberRepairActivityTicketCard activity={item} />
        </li>
      ))}
    </ul>
  );
}
