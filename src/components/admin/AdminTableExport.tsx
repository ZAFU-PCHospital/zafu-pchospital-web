"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { tableCopy } from "@/config/admin-tables";

export function AdminTableExport({
  path,
  params,
  disabled,
  onError,
  onDone,
}: {
  path: string;
  params: () => URLSearchParams;
  disabled: boolean;
  onError: (message: string) => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function download(format: "csv" | "xlsx") {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onError("");
    const query = new URLSearchParams(params());
    for (const key of ["page", "pageSize", "groupBy"]) query.delete(key);
    query.set("format", format);
    try {
      const response = await fetch(`${path}?${query}`);
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        onError(json?.error?.message ?? tableCopy.exportFailed);
        return;
      }
      const rawCount = response.headers.get("X-Export-Row-Count")?.trim();
      const count = Number(rawCount);
      if (!rawCount || !/^\d+$/.test(rawCount) || !Number.isSafeInteger(count)) {
        onError(tableCopy.exportFailed);
        return;
      }
      if (count === 0) {
        onError(tableCopy.exportEmpty);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ??
        `records.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      onDone(tableCopy.exportDone.replace("{count}", String(count)));
    } catch {
      onError(tableCopy.exportFailed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <span className="admin-actions admin-table-export">
      {(["csv", "xlsx"] as const).map((format) => (
        <Button
          className="admin-toolbar__desktop-only"
          key={format}
          icon="download"
          disabled={disabled || busy}
          onClick={() => void download(format)}
        >
          {tableCopy.exportCurrent} {format.toUpperCase()}
        </Button>
      ))}
      <ActionMenu
        className="admin-toolbar__mobile-only"
        label={tableCopy.exportShort}
        title={tableCopy.exportScope}
        disabled={disabled || busy}
        items={(["csv", "xlsx"] as const).map((format) => ({
          label: format.toUpperCase(),
          icon: "download",
          onSelect: () => void download(format),
        }))}
      />
    </span>
  );
}
