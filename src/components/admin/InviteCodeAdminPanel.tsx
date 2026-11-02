"use client";

import { useTableQuery } from "@/components/admin/useTableQuery";
import { tableQueryOptions } from "@/config/table-queries";

import { useCallback, useState, type FormEvent } from "react";
import { AdminTableQuery } from "@/components/admin/AdminTableQuery";

import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { AdminTable } from "@/components/admin/AdminTable";
import {
  formatDateTime,
  inviteCodeEmptyText,
  inviteCodeTableSpec,
} from "@/components/admin/invite-code-table-spec";
import { AdminListEnd, useAdminList } from "@/components/admin/useAdminList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared, inviteCodeStatusLabels } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import {
  type CreateInviteCodeResult,
  type InviteCodeAdminView,
  type InviteCodeView,
} from "@/types/contracts";

const QUERY_OPTIONS = tableQueryOptions("invite-codes");

const EMPTY_FILTERS = { query: "", status: "" };

/**
 * 邀请码管理（M6 批次 2，需求 §4.4「管理邀请码的创建、停用、有效期与使用次数」）。
 *
 * 三条与被管理对象本身有关的约束，界面必须如实表达：
 *
 * 1. **完整邀请码只在创建响应里出现一次**。库里只存 `codeDigest`，列表能拿到的只有
 *    明文前 8 位（`displayPrefix`）。所以创建成功后把明文显示在**内联**区块里并写明
 *    「只显示这一次」，而不是丢进会自动消失的浮层 —— 那会让人来不及抄下来。
 * 2. 绑定信息按 PII 规则脱敏显示，只能看出「绑了哪个号」的轮廓。
 * 3. 调整使用次数时不能小于已使用次数（服务端 400），界面就地说明原因。
 */
export function InviteCodeAdminPanel() {
  const copy = adminCopy.inviteCodes;
  /** 页面自己产生的错误（创建 / 调整 / 撤销失败）；取数错误走 `list.problem`。 */
  const [actionProblem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const query = useTableQuery(QUERY_OPTIONS, EMPTY_FILTERS);
  const requestParams = query.params;
  const sortRules = query.value.sort;
  const setSortRules = query.setSort;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plainCode, setPlainCode] = useState("");

  // 取数状态收在 `useAdminList` 里：往下滚动自动接下一页（邮箱式的连续列表，
  // 不再有「上一页 / 下一页」）。查询状态变化统一重载第一页。
  const list = useAdminList<InviteCodeAdminView>(
    useCallback(
      (targetPage: number, signal?: AbortSignal) =>
        adminFetch<InviteCodeAdminView[]>(
          `/api/v1/admin/invite-codes?${requestParams(targetPage)}`,
          { signal },
        ),
      [requestParams],
    ),
    { queryKey: query.ready ? query.signature : null },
  );
  const { items, pagination, state, problem, loadingMore } = list;
  const shownProblem = actionProblem || problem;

  const load = useCallback(async () => {
    await list.reload();
  }, [list]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    setPlainCode("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const result = await adminFetch<CreateInviteCodeResult>("/api/v1/admin/invite-codes", {
      method: "POST",
      body: {
        maxUses: Number(data.maxUses),
        activeFrom: toIso(data.activeFrom),
        expiresAt: toIso(data.expiresAt),
        boundQq: data.boundQq || undefined,
        boundPhone: data.boundPhone || undefined,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    form.reset();
    // 明文放进内联区块而不是浮层：浮层 4 秒就消失，来不及抄。
    setPlainCode(result.data.plainCode);
    setToast({ text: copy.create.created, tone: "success" });
    await load();
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<InviteCodeView>(`/api/v1/admin/invite-codes/${id}`, {
      method: "PATCH",
      body: {
        maxUses: data.maxUses === "" ? undefined : Number(data.maxUses),
        activeFrom: toIso(data.activeFrom),
        expiresAt: toIso(data.expiresAt),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(
        result.code === "INVITE_CODE_USAGE_LIMIT_INVALID"
          ? copy.policy.maxUsesInvalid
          : result.message,
      );
      return;
    }
    setEditingId(null);
    setToast({ text: copy.policy.saved, tone: "success" });
    await load();
  }

  async function revoke(item: InviteCodeAdminView) {
    if (item.status === "REVOKED") {
      setProblem(copy.notRevocable);
      return;
    }
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<InviteCodeView>(
      `/api/v1/admin/invite-codes/${item.id}/revoke`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setToast({ text: copy.revoked, tone: "neutral" });
    await load();
  }

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-invite-codes-title">
            {copy.title}
          </h1>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {shownProblem ? (
        <p className="admin-status admin-status--error" role="alert">
          {shownProblem}
        </p>
      ) : null}

      <Card className="admin-panel">
        <form method="post" className="admin-form" onSubmit={create} aria-label={copy.create.title}>
          <h2 className="admin-panel__title">{copy.create.title}</h2>
          <div className="admin-form__grid">
            <label className="field">
              <span className="field__label">{copy.create.maxUses}</span>
              <input
                className="field__input"
                type="number"
                name="maxUses"
                min={1}
                max={1000000}
                defaultValue={1}
                required
              />
              <span className="field__hint">{copy.create.maxUsesHint}</span>
            </label>
            <label className="field">
              <span className="field__label">{copy.create.activeFrom}</span>
              <input className="field__input" type="datetime-local" name="activeFrom" />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.expiresAt}</span>
              <input className="field__input" type="datetime-local" name="expiresAt" />
            </label>
            <label className="field">
              <span className="field__label">
                {copy.create.boundQq}（{copy.create.optional}）
              </span>
              <input className="field__input" name="boundQq" maxLength={11} inputMode="numeric" />
            </label>
            <label className="field">
              <span className="field__label">
                {copy.create.boundPhone}（{copy.create.optional}）
              </span>
              <input
                className="field__input"
                name="boundPhone"
                maxLength={11}
                inputMode="numeric"
              />
            </label>
          </div>
          <p className="admin-note">
            {copy.create.timeHint} {copy.create.bindingHint}
          </p>
          <div className="signup__actions">
            <Button type="submit" variant="solid" icon="plus" disabled={busy}>
              {busy ? adminShared.submitting : copy.create.submit}
            </Button>
          </div>
          {plainCode ? (
            <div role="status" aria-live="polite">
              <p className="admin-status">
                <code>{plainCode}</code>
              </p>
              <p className="admin-note">{copy.create.plainCodeNote}</p>
            </div>
          ) : null}
        </form>
      </Card>

      <AdminTableQuery
        ready={query.ready}
        value={query.value}
        options={QUERY_OPTIONS}
        quick={[
          { key: "query", label: copy.filter.query },
          {
            key: "status",
            label: copy.filter.status,
            options: Object.entries(inviteCodeStatusLabels).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
        onChange={query.setValue}
        onClear={query.reset}
        summary={list.summary}
        refreshing={list.refreshing}
        problem={list.problem}
      />

      {state === "loading" ? (
        <p className="admin-status" role="status">
          {adminShared.loading}
        </p>
      ) : null}

      {state === "error" ? (
        <Card variant="notice">
          <p>{problem || adminShared.loadFailed}</p>
          <Button onClick={() => void load()}>{adminShared.reload}</Button>
        </Card>
      ) : null}

      {state === "ready" ? (
        <div className="admin-list">
          <AdminListToolbar
            count={pagination?.total ?? items.length}
            refreshing={list.refreshing}
            previous={Boolean(list.problem)}
          />
          {/* 列定义由 spec 提供，跨列编辑行由 renderRow 接管。 */}
          <AdminTable
            spec={inviteCodeTableSpec}
            sort={sortRules}
            onSortChange={setSortRules}
            items={items}
            emptyText={inviteCodeEmptyText}
            renderContext={{
              busy,
              onEditPolicy: setEditingId,
              onRevoke: (item) => void revoke(item),
            }}
            renderRow={(item) =>
              editingId === item.id ? (
                <>
                  <td data-label={copy.table.prefix}>
                    <code>{item.displayPrefix}</code>
                  </td>
                  <td colSpan={4}>
                    <form
                      className="admin-form"
                      method="post"
                      onSubmit={(event) => void savePolicy(event, item.id)}
                      aria-label={`${copy.action.policy} ${item.displayPrefix}`}
                    >
                      <div className="admin-form__grid">
                        <label className="field">
                          <span className="field__label">{copy.create.maxUses}</span>
                          <input
                            className="field__input"
                            type="number"
                            name="maxUses"
                            min={Math.max(1, item.usedCount)}
                            max={1000000}
                            defaultValue={item.maxUses}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">{copy.create.activeFrom}</span>
                          <input
                            className="field__input"
                            type="datetime-local"
                            name="activeFrom"
                            defaultValue={toLocalInput(item.activeFrom)}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">{copy.create.expiresAt}</span>
                          <input
                            className="field__input"
                            type="datetime-local"
                            name="expiresAt"
                            defaultValue={toLocalInput(item.expiresAt)}
                          />
                        </label>
                      </div>
                      <div className="signup__actions">
                        <Button type="submit" disabled={busy}>
                          {copy.action.save}
                        </Button>
                        <Button variant="ghost" onClick={() => setEditingId(null)}>
                          {copy.action.cancel}
                        </Button>
                      </div>
                    </form>
                  </td>
                  <td data-label={copy.table.createdAt}>{formatDateTime(item.createdAt)}</td>
                  <td data-label={copy.table.actions}>{adminShared.none}</td>
                </>
              ) : null
            }
          />
          <AdminListEnd
            pagination={pagination}
            loaded={items.length}
            busy={loadingMore}
            onLoadMore={list.loadMore}
            labels={adminShared.listEnd}
          />
        </div>
      ) : null}
    </div>
  );
}

/** ISO 时刻 → `datetime-local` 需要的本地值（浏览器按用户本地时区解释）。 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `datetime-local` 的值 → ISO 时刻。
 *
 * `new Date("2026-09-23T10:00")` 按**浏览器本地时区**解释，`toISOString()` 再转成 UTC；
 * 直接把表单值发给服务端会让 `new Date(value)` 在服务器时区（UTC）里解释，
 * 于是用户填的 10:00 变成 UTC 10:00 = 上海 18:00，整体偏 8 小时。
 */
function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
