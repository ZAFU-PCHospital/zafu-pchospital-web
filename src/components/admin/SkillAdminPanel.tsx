"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { useRowDragSort } from "@/components/admin/useRowDragSort";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import { applyOrder, movedManyIds } from "@/lib/list-order";
import type { SkillAdminView, SkillView } from "@/types/contracts";

/**
 * 技能标签库管理（M6 批次 2，需求 §4.4「管理技能标签」）。
 *
 * 与故障分类管理同构：**只停用 / 启用，不提供删除**。标签被 `user_skills` 引用，
 * 物理删除会让历史成员标签无声消失；列表同时给出选用成员数，让管理员知道停用会影响到谁。
 */
export function SkillAdminPanel() {
  const copy = adminCopy.skills;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [items, setItems] = useState<SkillAdminView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // 停用/启用后要重载，但**不能**在重载期间卸载表格：表格一旦消失，页面高度瞬间塌下来，
    // 浏览器会把滚动位置夹回顶部（用户看到的就是「点一下，页面自己跳回最上面」）。
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<SkillAdminView[]>("/api/v1/admin/skills");
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

  async function toggle(skill: SkillAdminView) {
    setBusy(true);
    setProblem("");
    setToast(null);
    const path = skill.isActive ? "deactivate" : "activate";
    const result = await adminFetch<SkillView>(`/api/v1/admin/skills/${skill.id}/${path}`, {
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    // 停用是「成功地把开关关掉」，用叉；启用用对勾（与分类管理同一语气规则）。
    setToast({
      text: skill.isActive ? copy.deactivated : copy.activated,
      tone: skill.isActive ? "neutral" : "success",
    });
    await load();
  }

  /** 上移 / 下移一格。服务端幂等处理首末位，界面只是把按钮禁用掉。 */
  async function reorder(skillId: string, direction: "UP" | "DOWN") {
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<{ reordered: boolean }>(
      `/api/v1/admin/skills/${skillId}/reorder`,
      { method: "POST", body: { direction } },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setToast({ text: copy.reordered, tone: "success" });
    await load();
  }

  /**
   * 拖动排序：把一行拖到 `beforeId` 之前（`null` = 末尾）。
   *
   * 与 `reorder` 的区别只在于「一次挪几格」：拖动可以跨越任意行，
   * 一次提交、一条审计。
   */
  async function move(skillId: string, beforeId: string | null) {
    setProblem("");
    setToast(null);
    // 乐观更新：松手即到位（与成员表同一套规则、同一份手感），失败再回滚。
    const previous = items.map((item) => item.id);
    const { order } = movedManyIds(previous, [skillId], beforeId);
    if (order) setItems((current) => applyOrder(current, order));
    const result = await adminFetch<{ moved: boolean }>(`/api/v1/admin/skills/${skillId}/move`, {
      method: "POST",
      body: { beforeId },
    });
    if (!result.ok) {
      setItems((current) => applyOrder(current, previous));
      setProblem(result.message);
      return;
    }
    setToast({ text: copy.reordered, tone: "success" });
  }

  // 拖动排序只挂在鼠标上；键盘与触屏仍用每行的 ↑ ↓（HTML5 拖放在触屏上不触发）。
  const drag = useRowDragSort(
    items.map((item) => item.id),
    (id, beforeId) => void move(id, beforeId),
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const result = await adminFetch<SkillView>("/api/v1/admin/skills", {
      method: "POST",
      body: {
        name: data.name ?? "",
        description: data.description || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code === "SKILL_CODE_CONFLICT" ? copy.create.conflict : result.message);
      return;
    }
    form.reset();
    setToast({ text: copy.create.created, tone: "success" });
    await load();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, skillId: string) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<SkillView>(`/api/v1/admin/skills/${skillId}`, {
      method: "PATCH",
      body: { name: data.name ?? "", description: data.description || null },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setEditingId(null);
    setToast({ text: copy.updated, tone: "success" });
    await load();
  }

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-skills-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
      </div>

      {/* 成功反馈走顶部浮层：内联插一行会把下面的表单与表格顶下去，而且不会自己消失。 */}
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
              <span className="field__label">{copy.create.name}</span>
              <input className="field__input" name="name" required maxLength={80} />
              <span className="field__hint">{copy.create.nameHint}</span>
            </label>
            <label className="field">
              <span className="field__label">{copy.create.description}</span>
              <input className="field__input" name="description" maxLength={500} />
            </label>
          </div>
          <div className="signup__actions">
            <Button type="submit" variant="solid" icon="plus" disabled={busy}>
              {busy ? adminShared.submitting : copy.create.submit}
            </Button>
          </div>
        </form>
      </Card>

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
        <>
          <p className="admin-note">
            {copy.usageNote} {copy.orderNote}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">{copy.title}</caption>
              <thead>
                <tr>
                  {/* 拖动排序的手柄列。表头留空：这一列的内容（六个点）自解释，
                      写「排序」两个字反而比手柄本身还宽。 */}
                  <th scope="col" className="admin-table__grip">
                    <span className="sr-only">{copy.action.drag}</span>
                  </th>
                  <th scope="col" className="admin-table__grow">
                    {copy.table.name}
                  </th>
                  <th scope="col">{copy.table.description}</th>
                  <th scope="col">{copy.table.usage}</th>
                  <th scope="col">{copy.table.state}</th>
                  <th scope="col">{copy.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td className="admin-table__empty" colSpan={6}>
                      {adminShared.empty}
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) =>
                    editingId === item.id ? (
                      <tr key={item.id}>
                        <td className="admin-table__grip">{adminShared.none}</td>
                        <td className="admin-table__grow" data-label={copy.table.name}>
                          {item.name}
                        </td>
                        <td colSpan={2}>
                          <form
                            className="admin-form"
                            method="post"
                            onSubmit={(event) => void saveEdit(event, item.id)}
                            aria-label={`${copy.action.edit} ${item.name}`}
                          >
                            <div className="admin-form__grid">
                              <label className="field">
                                <span className="field__label">{copy.table.name}</span>
                                <input
                                  className="field__input"
                                  name="name"
                                  required
                                  maxLength={80}
                                  defaultValue={item.name}
                                />
                              </label>
                              <label className="field">
                                <span className="field__label">{copy.table.description}</span>
                                <input
                                  className="field__input"
                                  name="description"
                                  maxLength={500}
                                  defaultValue={item.description ?? ""}
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
                        <td data-label={copy.table.state}>
                          {item.isActive ? copy.state.active : copy.state.inactive}
                        </td>
                        <td data-label={copy.table.actions}>{adminShared.none}</td>
                      </tr>
                    ) : (
                      <tr
                        key={item.id}
                        className={drag.rowClass(item.id)}
                        {...drag.rowProps(item.id)}
                      >
                        <td className="admin-table__grip">
                          {/* 手柄是整个表格里唯一 `draggable` 的元素：整行可拖会让
                              「选中一行文字」变成拖行，而表格里的文字正是要能选中的。
                              `aria-hidden` 是因为键盘用户走 ↑ ↓ 按钮，这个手柄对他们
                              是一个按不动的控件。 */}
                          <span
                            className="admin-drag"
                            aria-hidden="true"
                            title={copy.action.drag}
                            {...drag.handleProps(item.id)}
                          >
                            <Icon name="grip" />
                          </span>
                        </td>
                        <td className="admin-table__grow" data-label={copy.table.name}>
                          {item.name}
                        </td>
                        <td data-label={copy.table.description}>
                          {item.description || adminShared.none}
                        </td>
                        <td data-label={copy.table.usage}>{item.usedByMemberCount}</td>
                        <td data-label={copy.table.state}>
                          <span
                            className={
                              item.isActive
                                ? "repair-tag repair-tag--approved"
                                : "admin-tag admin-tag--muted"
                            }
                          >
                            {item.isActive ? copy.state.active : copy.state.inactive}
                          </span>
                        </td>
                        <td data-label={copy.table.actions}>
                          <span className="admin-actions">
                            <span className="admin-actions__group">
                              <Button
                                variant="ghost"
                                disabled={busy || index === 0}
                                aria-label={copy.action.moveUp}
                                onClick={() => void reorder(item.id, "UP")}
                              >
                                <span aria-hidden="true">↑</span>
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={busy || index === items.length - 1}
                                aria-label={copy.action.moveDown}
                                onClick={() => void reorder(item.id, "DOWN")}
                              >
                                <span aria-hidden="true">↓</span>
                              </Button>
                            </span>
                            <Button
                              variant="ghost"
                              icon="edit"
                              onClick={() => setEditingId(item.id)}
                            >
                              {copy.action.edit}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() => void toggle(item)}
                            >
                              {item.isActive ? copy.action.deactivate : copy.action.activate}
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ),
                  )
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
