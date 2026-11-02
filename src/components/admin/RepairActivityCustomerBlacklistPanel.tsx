"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import type {
  CustomerBlacklistView,
  CustomerBlockView,
  NoShowEventView,
} from "@/features/repair-activities/repair-activity-customer-service";

const copy = adminCopy.repairActivities.customerBlacklist;

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 活动管理下的客户黑名单：自动/人工封锁、单次 no-show 豁免；手机号仅活动管理员可见。 */
export function RepairActivityCustomerBlacklistPanel() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<CustomerBlacklistView | null>(null);
  const [problem, setProblem] = useState("");
  const [formProblem, setFormProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [liftTarget, setLiftTarget] = useState<CustomerBlockView | null>(null);
  const [exemptTarget, setExemptTarget] = useState<NoShowEventView | null>(null);

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<CustomerBlacklistView>(
      "/api/v1/admin/repair-activities/customer-blacklist",
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!result.ok) {
      setState("error");
      setProblem(result.message || copy.loadFailed);
      return;
    }
    setData(result.data);
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setFormProblem("");
    const result = await adminFetch<{ id: string }>(
      "/api/v1/admin/repair-activities/customer-blacklist",
      {
        method: "POST",
        body: {
          name: values.name ?? "",
          phone: values.phone ?? "",
          reason: values.reason ?? "",
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setFormProblem(result.message);
      return;
    }
    form.reset();
    setToast({ text: copy.added, tone: "success" });
    await load();
  }

  async function confirmLift() {
    if (!liftTarget || busy) return;
    setBusy(true);
    const result = await adminFetch<{ lifted: boolean }>(
      `/api/v1/admin/repair-activities/customer-blacklist/${liftTarget.id}/lift`,
      { method: "POST", body: { reason: "" } },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setLiftTarget(null);
    setToast({ text: copy.saved, tone: "neutral" });
    await load();
  }

  async function confirmExempt() {
    if (!exemptTarget || busy) return;
    setBusy(true);
    const result = await adminFetch<{ exempted: boolean }>(
      `/api/v1/admin/repair-activities/no-show-events/${exemptTarget.id}/exempt`,
      { method: "POST", body: { note: "" } },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setExemptTarget(null);
    setToast({ text: copy.saved, tone: "neutral" });
    await load();
  }

  return (
    <Card className="admin-panel">
      <div className="admin-list-toolbar">
        <div>
          <h2 className="admin-panel__title">{copy.title}</h2>
          <p className="muted mt-s-2">{copy.intro}</p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          {adminShared.reload}
        </Button>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      <form className="admin-form" onSubmit={addBlock} aria-label={copy.manualTitle}>
        <h3 className="admin-panel__title">{copy.manualTitle}</h3>
        <div className="admin-form__grid">
          <label className="field">
            <span className="field__label">{copy.name}</span>
            <input className="field__input" name="name" required maxLength={40} />
          </label>
          <label className="field">
            <span className="field__label">{copy.phone}</span>
            <input className="field__input" name="phone" required type="tel" maxLength={11} />
          </label>
          <label className="field">
            <span className="field__label">{copy.reason}</span>
            <input className="field__input" name="reason" required minLength={2} maxLength={500} />
          </label>
        </div>
        <p className="field__hint">{copy.manualHint}</p>
        {formProblem ? (
          <p className="admin-status admin-status--error" role="alert">
            {formProblem}
          </p>
        ) : null}
        <div className="signup__actions">
          <Button type="submit" variant="solid" disabled={busy}>
            {busy ? adminShared.submitting : copy.add}
          </Button>
        </div>
      </form>

      {state === "loading" ? <p className="muted">{adminShared.loading}</p> : null}
      {state === "error" ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem || copy.loadFailed}
        </p>
      ) : null}

      {state === "ready" && data ? (
        <>
          <h3 className="admin-panel__title">{copy.blocksTitle}</h3>
          {data.blocks.length === 0 ? (
            <p className="muted">{copy.emptyBlocks}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{copy.name}</th>
                    <th>{copy.phone}</th>
                    <th>{copy.noShowCount}</th>
                    <th>{copy.status}</th>
                    <th>{copy.blockedUntil}</th>
                    <th>{copy.source}</th>
                    <th>{copy.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.blocks.map((block) => (
                    <tr key={block.id}>
                      <td data-label={copy.name}>{block.name}</td>
                      <td data-label={copy.phone}>{block.phone}</td>
                      <td data-label={copy.noShowCount}>{block.noShowCount}</td>
                      <td data-label={copy.status}>
                        <span
                          className={
                            block.status === "ACTIVE" ? "admin-status admin-status--error" : "muted"
                          }
                        >
                          {block.status === "ACTIVE"
                            ? copy.active
                            : block.status === "LIFTED"
                              ? copy.lifted
                              : copy.expired}
                        </span>
                      </td>
                      <td data-label={copy.blockedUntil}>{formatDateTime(block.blockedUntil)}</td>
                      <td data-label={copy.source}>
                        {block.source === "AUTO" ? copy.auto : copy.manual}
                      </td>
                      <td data-label={copy.actions}>
                        <div className="admin-row-actions">
                          <Button
                            variant="ghost"
                            disabled={busy || block.status !== "ACTIVE"}
                            onClick={() => setLiftTarget(block)}
                          >
                            {copy.lift}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="admin-panel__title">{copy.eventsTitle}</h3>
          {data.events.length === 0 ? (
            <p className="muted">{copy.emptyEvents}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{copy.activity}</th>
                    <th>{copy.activityDate}</th>
                    <th>{copy.name}</th>
                    <th>{copy.phone}</th>
                    <th>{copy.eventState}</th>
                    <th>{copy.source}</th>
                    <th>{copy.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event) => (
                    <tr key={event.id}>
                      <td data-label={copy.activity}>{event.activityTitle}</td>
                      <td data-label={copy.activityDate}>{formatDateTime(event.activityAt)}</td>
                      <td data-label={copy.name}>{event.name}</td>
                      <td data-label={copy.phone}>{event.phone}</td>
                      <td data-label={copy.eventState}>
                        <span
                          className={
                            event.state === "CONFIRMED"
                              ? "admin-status admin-status--error"
                              : "muted"
                          }
                        >
                          {event.state === "CONFIRMED" ? copy.confirmed : copy.excused}
                        </span>
                        {event.note ? <span className="muted"> · {event.note}</span> : null}
                      </td>
                      <td data-label={copy.source}>
                        {event.source === "MANUAL" ? copy.manual : copy.auto}
                      </td>
                      <td data-label={copy.actions}>
                        <div className="admin-row-actions">
                          <Button
                            variant="ghost"
                            disabled={busy || event.state === "EXCUSED"}
                            onClick={() => setExemptTarget(event)}
                          >
                            {copy.exempt}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {liftTarget ? (
        <ConfirmDialog
          title={copy.liftConfirmTitle}
          confirmLabel={copy.liftConfirm}
          cancelLabel={adminShared.cancel}
          busy={busy}
          onConfirm={() => void confirmLift()}
          onClose={() => {
            if (!busy) setLiftTarget(null);
          }}
        >
          <p>{copy.liftConfirmHint}</p>
          <p className="muted">
            {liftTarget.name} · {liftTarget.phone}
          </p>
        </ConfirmDialog>
      ) : null}

      {exemptTarget ? (
        <ConfirmDialog
          title={copy.exemptConfirmTitle}
          confirmLabel={copy.exemptConfirm}
          cancelLabel={adminShared.cancel}
          busy={busy}
          onConfirm={() => void confirmExempt()}
          onClose={() => {
            if (!busy) setExemptTarget(null);
          }}
        >
          <p>{copy.exemptConfirmHint}</p>
          <p className="muted">
            {exemptTarget.name} · {exemptTarget.phone} · {exemptTarget.activityTitle}
          </p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}
