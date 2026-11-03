"use client";

import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminCopy, adminShared } from "@/config/admin";
import { formatShanghaiDate } from "@/config/member";
import { adminFetch } from "@/features/admin/admin-client";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import type { RepairView } from "@/types/contracts";

/** 列表单条审核：确认后提交，失败保留原因与幂等键，成功应用服务端快照。 */
export function RepairReviewDialog({
  record,
  decision,
  onClose,
  onReviewed,
}: {
  record: RepairView;
  decision: "APPROVED" | "REJECTED";
  onClose: () => void;
  onReviewed: (record: RepairView) => void;
}) {
  const copy = adminCopy.repairs;
  const rejecting = decision === "REJECTED";
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useRef(createIdempotencyKey());

  async function submit() {
    if (inFlight.current || (rejecting && !note.trim())) return;
    inFlight.current = true;
    setBusy(true);
    setProblem("");
    try {
      const result = await adminFetch<RepairView>(`/api/v1/admin/repairs/${record.id}/reviews`, {
        method: "POST",
        body: { decision, note: rejecting ? note.trim() : undefined, idempotencyKey: key.current },
      });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      onReviewed(result.data);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={rejecting ? copy.review.submit : copy.review.approveTitle}
      confirmLabel={
        busy ? adminShared.submitting : rejecting ? copy.review.submit : copy.review.approveSubmit
      }
      cancelLabel={copy.review.cancel}
      onConfirm={() => void submit()}
      onClose={onClose}
      busy={busy}
      confirmDisabled={rejecting && !note.trim()}
    >
      <p className="admin-note">
        {record.member.name} · {formatShanghaiDate(record.repairDate)} ·{" "}
        {record.deviceModel || adminShared.none}
      </p>
      <p className="admin-note">{rejecting ? copy.review.rejectHint : copy.review.approveHint}</p>
      {rejecting ? (
        <label className="field">
          <span className="field__label">{copy.review.rejectTitle}</span>
          <textarea
            className="field__input"
            value={note}
            maxLength={2000}
            required
            disabled={busy}
            placeholder={copy.review.notePlaceholder}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>
      ) : null}
      <p
        className={`admin-status admin-status--error min-h-s-7 ${problem ? "" : "invisible"}`}
        role="alert"
      >
        {problem}
      </p>
    </ConfirmDialog>
  );
}
