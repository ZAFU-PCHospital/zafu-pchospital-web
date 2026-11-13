"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch, clearAdminCache, type AdminApiResult } from "@/features/admin/admin-client";
import {
  repairActivityIssueTypeLabels,
  repairActivityRegistrationStatusLabels,
} from "@/features/repair-activities/repair-activity-validation";
import type { RegistrationAdminView } from "@/features/repair-activities/repair-activity-service";
export function RepairActivityRegistrationsPanel({
  activityId,
  active = true,
  onChanged,
}: {
  activityId: string;
  active?: boolean;
  onChanged?: () => void;
}) {
  const copy = adminCopy.repairActivities;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [query, setQuery] = useState("");
  const [registrations, setRegistrations] = useState<RegistrationAdminView[]>([]);
  const [registrationState, setRegistrationState] = useState<"idle" | "loading" | "ready">(
    "loading",
  );
  const [registrationProblem, setRegistrationProblem] = useState("");
  const [registrationMutationProblem, setRegistrationMutationProblem] = useState("");
  const registrationWriteRef = useRef(false);
  const [editingRegistration, setEditingRegistration] = useState<RegistrationAdminView | null>(
    null,
  );
  const [removingRegistration, setRemovingRegistration] = useState<RegistrationAdminView | null>(
    null,
  );
  const registrationRequestRef = useRef(0);

  const loadRegistrations = useCallback(async (activityId: string, showLoading: boolean) => {
    const request = ++registrationRequestRef.current;
    if (showLoading) {
      setRegistrationState("loading");
      setRegistrations([]);
    }
    setRegistrationProblem("");
    clearAdminCache();
    const result = await adminFetch<RegistrationAdminView[]>(
      `/api/v1/admin/repair-activities/${activityId}/registrations`,
      { signal: AbortSignal.timeout(10_000) },
    );
    // 切换活动后旧请求不能覆盖新名单。
    if (request !== registrationRequestRef.current) return;
    if (!result.ok) {
      setRegistrationState("ready");
      setRegistrationProblem(result.message);
      return result;
    }
    setRegistrations(result.data);
    setRegistrationState("ready");
    return result;
  }, []);

  async function saveRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRegistration || registrationWriteRef.current) return;
    const registrationId = editingRegistration.id;
    registrationWriteRef.current = true;
    setBusy(true);
    setRegistrationMutationProblem("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const fields = {
      name: (data.name ?? "").trim(),
      phone: (data.phone ?? "").replace(/\D/g, ""),
      issueType: data.issueType ?? "",
    };
    try {
      const result = await adminFetch<RegistrationAdminView>(
        `/api/v1/admin/repair-activities/${activityId}/registrations/${registrationId}`,
        { method: "PATCH", body: fields, signal: AbortSignal.timeout(15_000) },
      );
      let saved = result.ok ? result.data : undefined;
      if (!result.ok && isUncertainRegistrationWrite(result)) {
        // 写入已提交但响应丢失时，用服务端当前字段确认结果，不重复发送 PATCH。
        const check = await loadRegistrations(activityId, false);
        const current = check?.ok
          ? check.data.find((item) => item.id === registrationId)
          : undefined;
        if (
          current &&
          !current.deletedAt &&
          current.name === fields.name &&
          current.phone === fields.phone &&
          current.issueType === fields.issueType
        )
          saved = current;
      }
      if (!saved) {
        if (!result.ok) setRegistrationMutationProblem(result.message);
        return;
      }
      setRegistrations((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      setEditingRegistration(null);
      setToast({ text: copy.registrations.saved, tone: "success" });
      // 重拉整份名单，避免其它行的「同名」标记停留在修改前的状态。
      await loadRegistrations(activityId, false);
    } finally {
      registrationWriteRef.current = false;
      setBusy(false);
    }
  }

  async function confirmRegistrationRemove() {
    if (!removingRegistration || registrationWriteRef.current) return;
    const registrationId = removingRegistration.id;
    registrationWriteRef.current = true;
    setBusy(true);
    setRegistrationMutationProblem("");
    try {
      const result = await adminFetch<{ deleted: boolean }>(
        `/api/v1/admin/repair-activities/${activityId}/registrations/${registrationId}`,
        { method: "DELETE", signal: AbortSignal.timeout(15_000) },
      );
      let deleted = result.ok && result.data.deleted;
      if (
        !result.ok &&
        (isUncertainRegistrationWrite(result) || result.code === "ACTIVITY_REGISTRATION_NOT_FOUND")
      ) {
        // 包括另一位管理员先删的情况；只有重读确认已删除，才完成当前确认流程。
        const check = await loadRegistrations(activityId, false);
        if (check?.ok) {
          const current = check.data.find((item) => item.id === registrationId);
          deleted = !current || Boolean(current.deletedAt);
        }
      }
      if (!deleted) {
        setRegistrationMutationProblem(
          result.ok ? copy.registrations.deleteFailed : result.message,
        );
        return;
      }
      setRegistrations((items) =>
        items.map((item) =>
          item.id === registrationId
            ? { ...item, deletedAt: item.deletedAt ?? new Date().toISOString() }
            : item,
        ),
      );
      setRemovingRegistration(null);
      setToast({ text: copy.registrations.deletedDone, tone: "neutral" });
      // 删除后同样重拉：同名标记与被删行一起刷新，再更新活动列表的名额计数。
      await loadRegistrations(activityId, false);
      onChanged?.();
    } finally {
      registrationWriteRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const requestScope = registrationRequestRef;
    if (active) void loadRegistrations(activityId, false);
    return () => {
      requestScope.current++;
    };
  }, [active, activityId, loadRegistrations]);
  /**
   * 报名列表的起始序号。这份报名一次取回、没有分页，因此永远是 1；
   * 口径与成员表的 `firstRowNumber + index` 一致 —— 序号是「列表里的第几行」，
   * 不是另一套业务编号。
   */
  const registrationFirstRowNumber = 1;
  const matching = registrations.filter(
    (row) => !query.trim() || row.name.includes(query.trim()) || row.phone.includes(query.trim()),
  );
  const activeRegistrations = matching.filter((registration) => !registration.deletedAt);
  const deletedRegistrations = matching.filter((registration) => registration.deletedAt);

  function renderRegistrationTable(rows: RegistrationAdminView[]) {
    return (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{copy.registrations.rowNumber}</th>
              <th>{copy.registrations.name}</th>
              <th>{copy.registrations.phone}</th>
              <th>{copy.registrations.issueType}</th>
              <th>{copy.registrations.deviceModel}</th>
              <th>{copy.registrations.status}</th>
              <th>{copy.table.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((registration, index) => (
              <tr key={registration.id}>
                <td data-label={copy.registrations.rowNumber}>
                  {registrationFirstRowNumber + index}
                </td>
                <td data-label={copy.registrations.name}>
                  <span className="admin-tags">
                    <span>{registration.name}</span>
                    {registration.hasSameNameActive ? (
                      <span className="admin-tag" title={copy.registrations.sameNameHint}>
                        {copy.registrations.sameName}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td data-label={copy.registrations.phone}>{registration.phone}</td>
                <td data-label={copy.registrations.issueType}>
                  {repairActivityIssueTypeLabels[registration.issueType] ?? registration.issueType}
                </td>
                <td data-label={copy.registrations.deviceModel}>
                  {registration.deviceModel ?? "—"}
                </td>
                <td data-label={copy.registrations.status}>
                  {registration.deletedAt
                    ? copy.registrations.deleted
                    : (repairActivityRegistrationStatusLabels[registration.status] ??
                      registration.status)}
                </td>
                <td data-label={copy.table.actions}>
                  <div className="admin-row-actions">
                    <Button
                      variant="ghost"
                      disabled={busy || Boolean(registration.deletedAt)}
                      onClick={() => {
                        setRegistrationMutationProblem("");
                        setEditingRegistration(registration);
                      }}
                    >
                      {copy.registrations.edit}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy || Boolean(registration.deletedAt)}
                      onClick={() => {
                        setRegistrationMutationProblem("");
                        setRemovingRegistration(registration);
                      }}
                    >
                      {copy.registrations.delete}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
      <label className="field">
        <span className="field__label">{adminCopy.activityWorkspace.search}</span>
        <input
          className="field__input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <Button
        variant="ghost"
        onClick={() => void loadRegistrations(activityId, false)}
        disabled={busy}
      >
        {adminCopy.activityWorkspace.refresh}
      </Button>
      {registrationProblem ? (
        <p className="admin-status admin-status--error" role="alert">
          {registrationProblem}
        </p>
      ) : null}
      {registrationState === "loading" ? <p className="muted">{adminShared.loading}</p> : null}
      {registrationState === "ready" &&
      activeRegistrations.length === 0 &&
      deletedRegistrations.length === 0 ? (
        <p className="muted">
          {query.trim()
            ? adminCopy.activityWorkspace.noMatchingRegistrations
            : copy.registrations.empty}
        </p>
      ) : null}
      {registrationState === "ready" && matching.length > 0 ? (
        <>
          <p className="muted">
            {copy.registrations.activeCount.replace("{count}", String(activeRegistrations.length))}
          </p>
          {activeRegistrations.length > 0 ? (
            renderRegistrationTable(activeRegistrations)
          ) : (
            <p className="muted">{copy.registrations.activeEmpty}</p>
          )}
          {deletedRegistrations.length > 0 ? (
            <details className="admin-registrations__history">
              <summary>
                {copy.registrations.deletedHistory.replace(
                  "{count}",
                  String(deletedRegistrations.length),
                )}
              </summary>
              {renderRegistrationTable(deletedRegistrations)}
            </details>
          ) : null}
        </>
      ) : null}
      {editingRegistration ? (
        <AdminModal
          title={copy.registrations.edit}
          onClose={() => {
            if (!busy) setEditingRegistration(null);
          }}
        >
          <form className="admin-form" onSubmit={saveRegistration}>
            <p
              className={`activity-board__feedback admin-status ${registrationMutationProblem ? "admin-status--error" : ""}`}
              role="alert"
            >
              {registrationMutationProblem}
            </p>
            <label className="field">
              <span className="field__label">{copy.registrations.name}</span>
              <input
                className="field__input"
                name="name"
                required
                minLength={2}
                maxLength={40}
                defaultValue={editingRegistration.name}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.registrations.phone}</span>
              <input
                className="field__input"
                name="phone"
                required
                inputMode="numeric"
                maxLength={11}
                defaultValue={editingRegistration.phone}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.registrations.issueType}</span>
              <select
                className="field__input"
                name="issueType"
                required
                defaultValue={editingRegistration.issueType}
                disabled={busy}
              >
                {Object.entries(repairActivityIssueTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="signup__actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditingRegistration(null)}
              >
                {copy.registrations.cancel}
              </Button>
              <Button type="submit" variant="solid" disabled={busy}>
                {busy ? adminShared.submitting : copy.registrations.save}
              </Button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {removingRegistration ? (
        <ConfirmDialog
          title={copy.registrations.delete}
          cancelLabel={copy.registrations.cancel}
          confirmLabel={busy ? adminShared.submitting : copy.registrations.delete}
          busy={busy}
          onClose={() => {
            if (!busy) setRemovingRegistration(null);
          }}
          onConfirm={() => void confirmRegistrationRemove()}
        >
          <p
            className={`activity-board__feedback admin-status ${registrationMutationProblem ? "admin-status--error" : ""}`}
            role="alert"
          >
            {registrationMutationProblem}
          </p>
          <p>{copy.registrations.deleteHint}</p>
          <p>
            <strong>
              {removingRegistration.name} · {removingRegistration.phone}
            </strong>
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
function isUncertainRegistrationWrite(result: Extract<AdminApiResult<unknown>, { ok: false }>) {
  return (
    result.status >= 500 ||
    ["NETWORK_ERROR", "INVALID_RESPONSE", "REQUEST_ABORTED"].includes(result.code)
  );
}
