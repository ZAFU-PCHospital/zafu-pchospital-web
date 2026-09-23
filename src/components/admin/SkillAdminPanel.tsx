"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminTable } from "@/components/admin/AdminTable";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { skillEmptyText, skillTableSpec } from "@/components/admin/skill-table-spec";
import { useRowDragSort } from "@/components/admin/useRowDragSort";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
          {/* 表格本体由内核渲染（`AdminTable`）：表头、`data-label`、空态、单元格内容
              全部来自 `skillTableSpec` 这一份定义（迁移前这三份是分开写的）。

              「编辑」那一行在**行内**把说明与选用成员两列合成一个表单（`colSpan={2}`），
              逐列渲染表达不了，因此走 `renderRow` **整行接管**（与邀请码表的「调整策略」
              同一处理）—— `<tr>`、列宽与 `data-label` 规则仍由内核负责，接管的只是
              「这一行里有哪些格子」。 */}
          <AdminTable
            spec={skillTableSpec}
            items={items}
            emptyText={skillEmptyText}
            renderContext={{
              busy,
              total: items.length,
              drag,
              onReorder: (skillId, direction) => void reorder(skillId, direction),
              onToggle: (skill) => void toggle(skill),
              onEdit: setEditingId,
            }}
            // 拖动排序挂在 `<tr>` 上（手柄本身在 spec 里）。编辑中的那一行是表单：
            // 既没有拖动语义，也不该被标成落点行，所以接管这一行时不给任何行属性。
            rowProps={(item) =>
              editingId === item.id
                ? {}
                : { className: drag.rowClass(item.id), ...drag.rowProps(item.id) }
            }
            renderRow={(item) =>
              editingId === item.id ? (
                <>
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
                </>
              ) : null
            }
          />
        </>
      ) : null}
    </div>
  );
}
