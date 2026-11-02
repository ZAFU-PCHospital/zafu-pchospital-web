"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AdminModal } from "@/components/admin/AdminModal";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { RepairActivityCustomerBlacklistPanel } from "@/components/admin/RepairActivityCustomerBlacklistPanel";
import { repairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch, type AdminApiResult } from "@/features/admin/admin-client";
import {
  repairActivityIssueTypeLabels,
  repairActivityRegistrationStatusLabels,
  repairActivityStatusShortLabels,
  REPAIR_ACTIVITY_CAPACITY_MIN,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import type {
  RegistrationAdminView,
  RepairActivityAdminView,
} from "@/features/repair-activities/repair-activity-service";

/**
 * 维修活动管理（M1）：列表 + 新建/编辑表单 + 软删确认。
 * 交互对齐 SkillAdminPanel / CategoryAdminPanel，时间字段对齐 InviteCodeAdminPanel。
 */
export function RepairActivityAdminPanel() {
  const copy = adminCopy.repairActivities;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [items, setItems] = useState<RepairActivityAdminView[]>([]);
  const [editing, setEditing] = useState<RepairActivityAdminView | null>(null);
  const [removing, setRemoving] = useState<RepairActivityAdminView | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCustomerBlacklist, setShowCustomerBlacklist] = useState(false);
  const [registrationActivity, setRegistrationActivity] = useState<RepairActivityAdminView | null>(
    null,
  );
  const [registrations, setRegistrations] = useState<RegistrationAdminView[]>([]);
  const [registrationState, setRegistrationState] = useState<"idle" | "loading" | "ready">("idle");
  const [registrationProblem, setRegistrationProblem] = useState("");
  const [registrationMutationProblem, setRegistrationMutationProblem] = useState("");
  const registrationWriteRef = useRef(false);
  const registrationDialogRef = useRef<HTMLDivElement>(null);
  const [editingRegistration, setEditingRegistration] = useState<RegistrationAdminView | null>(
    null,
  );
  const [removingRegistration, setRemovingRegistration] = useState<RegistrationAdminView | null>(
    null,
  );

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<RepairActivityAdminView[]>("/api/v1/admin/repair-activities", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) {
      setState("error");
      setProblem(result.message);
      return;
    }
    setItems(result.data);
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!registrationActivity || editingRegistration || removingRegistration) return;
    // 子窗口关闭后仍在名单中：维持滚动锁，并把焦点交回仍存在的名单窗口。
    document.body.style.overflow = "hidden";
    const dialog = registrationDialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }, [registrationActivity, registrationState, editingRegistration, removingRegistration]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const result = await adminFetch<RepairActivityAdminView>("/api/v1/admin/repair-activities", {
      method: "POST",
      body: {
        title: data.title ?? "",
        capacity: Number(data.capacity),
        activityAt: toIso(data.activityAt ?? ""),
        signupOpensAt: toIso(data.signupOpensAt ?? ""),
        signupClosesAt: toIso(data.signupClosesAt ?? ""),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    form.reset();
    setToast({ text: copy.create.created, tone: "success" });
    await load();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setProblem("");
    setToast(null);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<RepairActivityAdminView>(
      `/api/v1/admin/repair-activities/${editing.id}`,
      {
        method: "PATCH",
        body: {
          title: data.title ?? "",
          capacity: Number(data.capacity),
          activityAt: toIso(data.activityAt ?? ""),
          signupOpensAt: toIso(data.signupOpensAt ?? ""),
          signupClosesAt: toIso(data.signupClosesAt ?? ""),
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setEditing(null);
    setToast({ text: copy.edit.saved, tone: "success" });
    await load();
  }

  const registrationRequestRef = useRef(0);

  const loadRegistrations = useCallback(async (activityId: string, showLoading: boolean) => {
    const request = ++registrationRequestRef.current;
    if (showLoading) {
      setRegistrationState("loading");
      setRegistrations([]);
    }
    setRegistrationProblem("");
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

  async function openRegistrations(activity: RepairActivityAdminView) {
    setRegistrationActivity(activity);
    setEditingRegistration(null);
    setRemovingRegistration(null);
    setRegistrationMutationProblem("");
    await loadRegistrations(activity.id, true);
  }

  async function saveRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registrationActivity || !editingRegistration || registrationWriteRef.current) return;
    const activityId = registrationActivity.id;
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
    if (!registrationActivity || !removingRegistration || registrationWriteRef.current) return;
    const activityId = registrationActivity.id;
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
      await load();
    } finally {
      registrationWriteRef.current = false;
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<{ deleted: boolean }>(
      `/api/v1/admin/repair-activities/${removing.id}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setRemoving(null);
    setToast({ text: copy.removePanel.done, tone: "neutral" });
    await load();
  }

  /**
   * 报名列表的起始序号。这份报名一次取回、没有分页，因此永远是 1；
   * 口径与成员表的 `firstRowNumber + index` 一致 —— 序号是「列表里的第几行」，
   * 不是另一套业务编号。
   */
  const registrationFirstRowNumber = 1;
  const activeRegistrations = registrations.filter((registration) => !registration.deletedAt);
  const deletedRegistrations = registrations.filter((registration) => registration.deletedAt);

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
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-repair-activities-title">
            {copy.title}
          </h1>
        </div>
        <Button variant="ghost" onClick={() => setShowCustomerBlacklist((current) => !current)}>
          {showCustomerBlacklist ? copy.customerBlacklist.hide : copy.customerBlacklist.toggle}
        </Button>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      <Card className="admin-panel">
        <form method="post" className="admin-form" onSubmit={create} aria-label={copy.create.title}>
          <h2 className="admin-panel__title">{copy.create.title}</h2>
          <div className="admin-form__grid">
            <label className="field">
              <span className="field__label">{copy.create.titleField}</span>
              <input className="field__input" name="title" required maxLength={120} />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.capacity}</span>
              <input
                className="field__input"
                name="capacity"
                type="number"
                required
                // Keep browser validation aligned with assertValidCapacity (server lower bound = 1).
                min={REPAIR_ACTIVITY_CAPACITY_MIN}
                max={10000}
                defaultValue={30}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.signupOpensAt}</span>
              <input className="field__input" type="datetime-local" name="signupOpensAt" required />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.signupClosesAt}</span>
              <input
                className="field__input"
                type="datetime-local"
                name="signupClosesAt"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.activityAt}</span>
              <input className="field__input" type="datetime-local" name="activityAt" required />
            </label>
          </div>
          <p className="field__hint">{copy.create.timeHint}</p>
          <div className="signup__actions">
            <Button type="submit" variant="solid" icon="plus" disabled={busy}>
              {busy ? adminShared.submitting : copy.create.submit}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="admin-panel">
        <div className="admin-list-toolbar">
          <p className="muted">
            {state === "loading"
              ? adminShared.loading
              : copy.count.replace("{count}", String(items.length))}
          </p>
          {state === "error" ? (
            <Button variant="ghost" onClick={() => void load()}>
              {adminShared.reload}
            </Button>
          ) : null}
        </div>

        {state === "ready" && items.length === 0 ? (
          <p className="muted">{adminShared.empty}</p>
        ) : null}

        {items.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{copy.table.title}</th>
                  <th>{copy.table.activityAt}</th>
                  <th>{copy.table.window}</th>
                  <th>{copy.table.capacity}</th>
                  <th>{copy.table.attendance}</th>
                  <th>{copy.table.status}</th>
                  <th>{copy.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label={copy.table.title}>{item.title}</td>
                    <td data-label={copy.table.activityAt}>{formatDateTime(item.activityAt)}</td>
                    <td data-label={copy.table.window}>
                      {formatDateTime(item.signupOpensAt)}
                      <span className="muted"> → </span>
                      {formatDateTime(item.signupClosesAt)}
                    </td>
                    <td data-label={copy.table.capacity}>
                      <span className="admin-capacity">
                        {copy.capacityLine
                          .replace("{registered}", String(item.registeredCount))
                          .replace("{capacity}", String(item.capacity))}
                      </span>
                      <br />
                      <span className="muted">
                        {copy.remaining.replace("{count}", String(item.remaining))}
                      </span>
                    </td>
                    <td data-label={copy.table.attendance}>
                      <span className="admin-capacity">
                        {copy.attendanceLine.replace("{count}", String(item.attendedCount))}
                      </span>
                    </td>
                    <td data-label={copy.table.status}>
                      <span className={repairActivityStatusBadgeClass(item.status)}>
                        {repairActivityStatusShortLabels[item.status as RepairActivityStatus] ??
                          item.status}
                      </span>
                    </td>
                    <td data-label={copy.table.actions}>
                      <div className="admin-row-actions">
                        <Button variant="ghost" disabled={busy} onClick={() => setEditing(item)}>
                          {copy.action.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void openRegistrations(item)}
                        >
                          {copy.action.registrations}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => setRemoving(item)}>
                          {copy.action.remove}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {showCustomerBlacklist ? <RepairActivityCustomerBlacklistPanel /> : null}

      {editing ? (
        <AdminModal title={copy.edit.title} onClose={() => setEditing(null)}>
          <form className="admin-form" onSubmit={saveEdit}>
            <div className="admin-form__grid">
              <label className="field">
                <span className="field__label">{copy.create.titleField}</span>
                <input
                  className="field__input"
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={editing.title}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.capacity}</span>
                <input
                  className="field__input"
                  name="capacity"
                  type="number"
                  required
                  min={REPAIR_ACTIVITY_CAPACITY_MIN}
                  max={10000}
                  defaultValue={editing.capacity}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.signupOpensAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="signupOpensAt"
                  required
                  defaultValue={toLocalInput(editing.signupOpensAt)}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.signupClosesAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="signupClosesAt"
                  required
                  defaultValue={toLocalInput(editing.signupClosesAt)}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.activityAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="activityAt"
                  required
                  defaultValue={toLocalInput(editing.activityAt)}
                />
              </label>
            </div>
            <div className="signup__actions">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {copy.edit.cancel}
              </Button>
              <Button type="submit" variant="solid" disabled={busy}>
                {busy ? adminShared.submitting : copy.edit.submit}
              </Button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {registrationActivity ? (
        <AdminModal
          dialogRef={registrationDialogRef}
          title={copy.registrations.title}
          subtitle={registrationActivity.title}
          onClose={() => {
            if (!busy && !editingRegistration && !removingRegistration)
              setRegistrationActivity(null);
          }}
        >
          {registrationProblem ? (
            <p className="admin-status admin-status--error" role="alert">
              {registrationProblem}
            </p>
          ) : null}
          {registrationState === "loading" ? <p className="muted">{adminShared.loading}</p> : null}
          {registrationState === "ready" &&
          activeRegistrations.length === 0 &&
          deletedRegistrations.length === 0 ? (
            <p className="muted">{copy.registrations.empty}</p>
          ) : null}
          {registrationState === "ready" && registrations.length > 0 ? (
            <>
              <p className="muted">
                {copy.registrations.activeCount.replace(
                  "{count}",
                  String(activeRegistrations.length),
                )}
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
        </AdminModal>
      ) : null}

      {editingRegistration && registrationActivity ? (
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

      {removing ? (
        <ConfirmDialog
          title={copy.removePanel.title}
          cancelLabel={copy.removePanel.cancel}
          confirmLabel={busy ? adminShared.submitting : copy.removePanel.submit}
          busy={busy}
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
          onConfirm={() => void confirmRemove()}
        >
          <p>{copy.removePanel.hint}</p>
          <p>
            <strong>{removing.title}</strong>
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function isUncertainRegistrationWrite(result: Extract<AdminApiResult<unknown>, { ok: false }>) {
  return (
    result.status >= 500 ||
    ["NETWORK_ERROR", "INVALID_RESPONSE", "REQUEST_ABORTED"].includes(result.code)
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
