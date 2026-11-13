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
import { adminFetch } from "@/features/admin/admin-client";
import {
  repairActivityStatusShortLabels,
  REPAIR_ACTIVITY_CAPACITY_MIN,
  REPAIR_ACTIVITY_DEFAULT_DURATION_MINUTES,
  REPAIR_ACTIVITY_LOCATION_MAX_LENGTH,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import type { RepairActivityAdminView } from "@/features/repair-activities/repair-activity-service";

/**
 * 维修活动管理（M1）：列表 + 新建/编辑表单 + 软删确认。
 * 交互对齐 SkillAdminPanel / CategoryAdminPanel，时间字段对齐 InviteCodeAdminPanel。
 */
export function RepairActivityAdminPanel() {
  const copy = adminCopy.repairActivities;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [modalProblem, setModalProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [items, setItems] = useState<RepairActivityAdminView[]>([]);
  const [editing, setEditing] = useState<RepairActivityAdminView | null>(null);
  const [removing, setRemoving] = useState<RepairActivityAdminView | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCustomerBlacklist, setShowCustomerBlacklist] = useState(false);
  /** 结束时间联动：开始时间改动时自动填 +2h，用户手动改过结束时间后不再覆盖。 */
  const createEndsAtRef = useRef<HTMLInputElement>(null);
  const createEndsAtTouchedRef = useRef(false);
  const editEndsAtRef = useRef<HTMLInputElement>(null);
  const editEndsAtTouchedRef = useRef(false);

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
        location: data.location ?? "",
        capacity: Number(data.capacity),
        activityAt: toIso(data.activityAt ?? ""),
        endsAt: toIso(data.endsAt ?? ""),
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
    createEndsAtTouchedRef.current = false;
    setToast({ text: copy.create.created, tone: "success" });
    await load();
  }

  /**
   * 打开 / 关闭编辑窗都清掉「已手改结束时间」标记：
   * 否则改过活动 A 的结束时间后，打开活动 B 改开始时间就不再自动填充（跨活动状态泄漏）。
   */
  function openEdit(item: RepairActivityAdminView) {
    editEndsAtTouchedRef.current = false;
    setModalProblem("");
    setEditing(item);
  }

  function closeEdit() {
    if (busy) return;
    editEndsAtTouchedRef.current = false;
    setEditing(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    try {
      setModalProblem("");
      setToast(null);
      const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
      const result = await adminFetch<RepairActivityAdminView>(
        `/api/v1/admin/repair-activities/${editing.id}`,
        {
          method: "PATCH",
          body: {
            title: data.title ?? "",
            location: data.location ?? "",
            capacity: Number(data.capacity),
            activityAt: toIso(data.activityAt ?? ""),
            endsAt: toIso(data.endsAt ?? ""),
            signupOpensAt: toIso(data.signupOpensAt ?? ""),
            signupClosesAt: toIso(data.signupClosesAt ?? ""),
          },
        },
      );
      if (!result.ok) {
        setModalProblem(result.message);
        return;
      }
      editEndsAtTouchedRef.current = false;
      setEditing(null);
      setToast({ text: copy.edit.saved, tone: "success" });
      await load();
    } catch (error) {
      setModalProblem(error instanceof Error ? error.message : adminShared.operationFailed);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing || busy) return;
    setBusy(true);
    try {
      setModalProblem("");
      setToast(null);
      const result = await adminFetch<{ deleted: boolean }>(
        `/api/v1/admin/repair-activities/${removing.id}`,
        { method: "DELETE" },
      );
      if (!result.ok) {
        setModalProblem(result.message);
        return;
      }
      setRemoving(null);
      setToast({ text: copy.removePanel.done, tone: "neutral" });
      await load();
    } catch (error) {
      setModalProblem(error instanceof Error ? error.message : adminShared.operationFailed);
    } finally {
      setBusy(false);
    }
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
              <span className="field__label">{copy.create.location}</span>
              <input
                className="field__input"
                name="location"
                required
                maxLength={REPAIR_ACTIVITY_LOCATION_MAX_LENGTH}
                placeholder={copy.create.locationPlaceholder}
              />
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
              <input
                className="field__input"
                type="datetime-local"
                name="activityAt"
                required
                onChange={(event) => {
                  fillSuggestedEnd(
                    event.currentTarget.value,
                    createEndsAtRef,
                    createEndsAtTouchedRef,
                  );
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.endsAt}</span>
              <input
                className="field__input"
                type="datetime-local"
                name="endsAt"
                required
                ref={createEndsAtRef}
                onChange={() => {
                  createEndsAtTouchedRef.current = true;
                }}
              />
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
                  <th>{copy.table.location}</th>
                  <th>{copy.table.activityAt}</th>
                  <th>{copy.table.endsAt}</th>
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
                    <td data-label={copy.table.location}>{item.location ?? "—"}</td>
                    <td data-label={copy.table.activityAt}>{formatDateTime(item.activityAt)}</td>
                    <td data-label={copy.table.endsAt}>
                      {item.endsAt ? formatDateTime(item.endsAt) : "—"}
                    </td>
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
                        <Button
                          variant="ghost"
                          href={`/admin/repair-activities/${item.id}?tab=board`}
                        >
                          {adminCopy.activityWorkspace.enterBoard}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => openEdit(item)}>
                          {copy.action.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          href={`/admin/repair-activities/${item.id}?tab=registrations`}
                        >
                          {copy.action.registrations}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setModalProblem("");
                            setRemoving(item);
                          }}
                        >
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
        <AdminModal title={copy.edit.title} onClose={closeEdit} error={modalProblem}>
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
                <span className="field__label">{copy.create.location}</span>
                <input
                  className="field__input"
                  name="location"
                  maxLength={REPAIR_ACTIVITY_LOCATION_MAX_LENGTH}
                  placeholder={copy.create.locationPlaceholder}
                  defaultValue={editing.location ?? ""}
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
                  onChange={(event) => {
                    fillSuggestedEnd(
                      event.currentTarget.value,
                      editEndsAtRef,
                      editEndsAtTouchedRef,
                    );
                  }}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.endsAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="endsAt"
                  ref={editEndsAtRef}
                  defaultValue={editing.endsAt ? toLocalInput(editing.endsAt) : ""}
                  onChange={() => {
                    editEndsAtTouchedRef.current = true;
                  }}
                />
              </label>
            </div>
            <p className="field__hint">{copy.edit.legacyHint}</p>
            <div className="signup__actions">
              <Button type="button" variant="ghost" onClick={closeEdit}>
                {copy.edit.cancel}
              </Button>
              <Button type="submit" variant="solid" disabled={busy}>
                {busy ? adminShared.submitting : copy.edit.submit}
              </Button>
            </div>
          </form>
        </AdminModal>
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
          {modalProblem ? (
            <p className="admin-status admin-modal__error" role="alert">
              {modalProblem}
            </p>
          ) : null}
          <p>
            <strong>{removing.title}</strong>
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
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

/**
 * 开始时间 → 建议的结束时间（`datetime-local` 本地值）：开始 + 默认时长（2 小时）。
 * 用户已手动改过结束时间、或开始时间还解析不出时返回 null，调用方不覆盖当前值。
 */
export function suggestedEndsAtLocal(startValue: string, endsAtTouched: boolean): string | null {
  if (endsAtTouched) return null;
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return null;
  return toLocalInput(
    new Date(start.getTime() + REPAIR_ACTIVITY_DEFAULT_DURATION_MINUTES * 60_000).toISOString(),
  );
}

/**
 * 把建议结束时间写进非受控控件：直接写 DOM 值不会触发 change，
 * 因此不会把「用户手动改过」的标记打上。
 */
function fillSuggestedEnd(
  startValue: string,
  endsAtRef: { current: HTMLInputElement | null },
  touchedRef: { current: boolean },
): void {
  const next = suggestedEndsAtLocal(startValue, touchedRef.current);
  const input = endsAtRef.current;
  if (!next || !input) return;
  input.value = next;
}
