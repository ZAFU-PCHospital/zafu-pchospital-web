"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminTable } from "@/components/admin/AdminTable";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { categoryTableSpec } from "@/components/admin/category-table-spec";
import type { CategoryTableContext } from "@/components/admin/category-table-spec";
import { useRowDragSort } from "@/components/admin/useRowDragSort";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import { applyOrder, movedManyIds } from "@/lib/list-order";
import type { RepairCategoryAdminView, RepairCategoryView } from "@/types/contracts";

/**
 * 故障分类管理（M6 §65）。
 *
 * 需求明确「已被维修记录使用过的分类不建议物理删除」，因此本界面**只提供停用与启用**，
 * 没有删除按钮；列表同时给出引用计数，让管理员一眼看出哪些分类已经有历史数据。
 */
export function CategoryAdminPanel() {
  const copy = adminCopy.categories;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [items, setItems] = useState<RepairCategoryAdminView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // 停用/启用后必须重载列表，但**不能**在重载期间把表格卸载掉：
    // 表格一旦消失，页面高度瞬间塌下来，浏览器会把滚动位置夹回顶部
    // （用户看到的就是「点一下停用，页面自己跳回最上面」）。
    // 首次加载之外一律保持 `ready`，原地替换行数据。
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<RepairCategoryAdminView[]>("/api/v1/admin/repair-categories");
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

  async function toggle(category: RepairCategoryAdminView) {
    setBusy(true);
    setProblem("");
    setToast(null);
    const path = category.isActive ? "deactivate" : "activate";
    const result = await adminFetch<RepairCategoryView>(
      `/api/v1/admin/repair-categories/${category.id}/${path}`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    // 停用是「成功地把开关关掉」，用叉；启用用对勾。
    setToast({
      text: category.isActive ? copy.deactivated : copy.activated,
      tone: category.isActive ? "neutral" : "success",
    });
    await load();
  }

  /** 上移 / 下移一格（与技能标签同一交互，见 `SkillAdminPanel`）。 */
  async function reorder(categoryId: string, direction: "UP" | "DOWN") {
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<{ reordered: boolean }>(
      `/api/v1/admin/repair-categories/${categoryId}/reorder`,
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

  /** 拖动排序：把一行拖到 `beforeId` 之前（`null` = 末尾）。与技能标签同一实现。 */
  async function move(categoryId: string, beforeId: string | null) {
    setProblem("");
    setToast(null);
    // 乐观更新：松手即到位（与成员表同一套规则、同一份手感），失败再回滚。
    const previous = items.map((item) => item.id);
    const { order } = movedManyIds(previous, [categoryId], beforeId);
    if (order) setItems((current) => applyOrder(current, order));
    const result = await adminFetch<{ moved: boolean }>(
      `/api/v1/admin/repair-categories/${categoryId}/move`,
      { method: "POST", body: { beforeId } },
    );
    if (!result.ok) {
      setItems((current) => applyOrder(current, previous));
      setProblem(result.message);
      return;
    }
    setToast({ text: copy.reordered, tone: "success" });
  }

  // 拖动只挂在鼠标上；键盘与触屏仍用每行的 ↑ ↓。
  const drag = useRowDragSort(
    items.map((item) => item.id),
    (id, beforeId) => void move(id, beforeId),
  );

  /**
   * 单元格渲染要用的运行时值（`<AdminTable renderContext>` 传入）。
   *
   * 行序、按钮禁用状态、拖动控制器都不进 spec：spec 是模块级常量，会变的值每次渲染从这里进
   * （否则 spec 的引用一变，以列为依赖的列宽对齐就会重跑）。
   */
  const categoryContext: CategoryTableContext = {
    busy,
    total: items.length,
    drag,
    onReorder: (categoryId, direction) => void reorder(categoryId, direction),
    onToggle: (category) => void toggle(category),
    onEdit: setEditingId,
  };

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const result = await adminFetch<RepairCategoryView>("/api/v1/admin/repair-categories", {
      method: "POST",
      body: { name: data.name ?? "", description: data.description || null },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(
        result.code === "REPAIR_CATEGORY_CODE_CONFLICT" ? copy.create.conflict : result.message,
      );
      return;
    }
    form.reset();
    setToast({ text: copy.create.created, tone: "success" });
    await load();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, categoryId: string) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<RepairCategoryView>(
      `/api/v1/admin/repair-categories/${categoryId}`,
      {
        method: "PATCH",
        body: {
          name: data.name ?? "",
          description: data.description || null,
          sortOrder: data.sortOrder === "" ? undefined : Number(data.sortOrder),
        },
      },
    );
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
          <h1 className="admin-workspace__title" id="admin-categories-title">
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
              全部来自 `categoryTableSpec` 这一份定义（迁移前这三份是分开写的）。

              「编辑」那一行在**行内**把说明与引用记录两列合成一个表单（`colSpan={2}`），
              逐列渲染表达不了，因此走 `renderRow` **整行接管**（与技能标签表、邀请码表的
              「调整策略」同一处理）—— `<tr>`、列宽与 `data-label` 规则仍由内核负责，
              接管的只是「这一行里有哪些格子」。

              也不传 `onSortChange`：列表顺序就是拖动排序维护的那一份，后端没有 `sort`
              参数；开了表头排序就会出现「拖了但顺序不变」的假入口
              （`docs/admin-table-kernel.md` §5.1）。 */}
          <AdminTable
            spec={categoryTableSpec}
            items={items}
            renderContext={categoryContext}
            emptyText={adminShared.empty}
            // 拖动排序挂在 `<tr>` 上（手柄本身在 spec 里）。编辑中的那一行是表单：
            // 既没有拖动语义，也不该被标成落点行，所以接管这一行时不给任何行属性。
            rowProps={(category) =>
              editingId === category.id
                ? {}
                : { className: drag.rowClass(category.id), ...drag.rowProps(category.id) }
            }
            renderRow={(category) =>
              editingId === category.id ? (
                <>
                  {/* 这一段是迁移前那一行的标记，逐字搬过来：跨列的表单表达不了，
                      所以整行由面板渲染，而不是在 spec 里塞一堆条件分支。 */}
                  <td className="admin-table__grip">{adminShared.none}</td>
                  <td className="admin-table__grow" data-label={copy.table.name}>
                    {category.name}
                  </td>
                  <td colSpan={2}>
                    <form
                      className="admin-form"
                      method="post"
                      onSubmit={(event) => void saveEdit(event, category.id)}
                      aria-label={`${copy.action.edit} ${category.name}`}
                    >
                      <div className="admin-form__grid">
                        <label className="field">
                          <span className="field__label">{copy.table.name}</span>
                          <input
                            className="field__input"
                            name="name"
                            required
                            maxLength={80}
                            defaultValue={category.name}
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">{copy.table.description}</span>
                          <input
                            className="field__input"
                            name="description"
                            maxLength={500}
                            defaultValue={category.description ?? ""}
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
                    {category.isActive ? copy.state.active : copy.state.inactive}
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
