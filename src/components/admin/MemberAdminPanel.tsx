"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminBatchTools } from "@/components/admin/AdminBatchTools";
import { AdminListEnd, useAdminList } from "@/components/admin/useAdminList";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminModal } from "@/components/admin/AdminModal";
import { useColumnResize, type ColumnSpec } from "@/components/admin/useColumnResize";
import { useRowDragSort } from "@/components/admin/useRowDragSort";
import { useRowSelect } from "@/components/admin/useRowSelect";
import { movingRowIds } from "@/lib/list-order";
import { Icon } from "@/components/ui/Icon";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { MemberCreateForm } from "@/components/admin/MemberCreateForm";
import { MemberDetailPanel } from "@/components/admin/MemberDetailPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy, adminShared, memberRoleLabels, memberStatusLabels } from "@/config/admin";
import { formatDurationMinutes, formatShanghaiDate } from "@/config/member";
import { adminFetch, prefetchAdmin } from "@/features/admin/admin-client";
import { MemberStatus, RoleCode } from "@/types/contracts";
import type { MemberBatchToggleResult, MemberListEntry } from "@/types/contracts";

type Filters = { query: string; status: string; role: string };

/** 成员表「技能标签」列最多显示几枚（多出来的收成 `+N`，完整列表在 `title` 上）。 */
const SKILL_TAGS_SHOWN = 2;

/**
 * 列宽（px）。**顺序必须与表头 `<th>` 一致**（`<colgroup>` 是按顺序对列的）。
 *
 * 第九轮验收改了两件事：
 * 1. 行首不再独占一列 —— 六点手柄与序号并进「成员」单元格（用户反馈「复选框到成员之间
 *    还是雷霆大宽度，和首列属性共享一个区域好了」）。省下的 56px 全给姓名。
 * 2. 没有「吸附列」了：宽度由 `useColumnResize` 保证**总和恒等于容器宽**，
 *    所以每一列都能拖、拖动时相邻两列对冲，表格永远不会被撑出横向滚动条。
 *
 * 总和 = 1079px，正好是 1440px 窗口下表格内容区的宽度；窗口更宽时差额由最后一列吸收。
 */
const COLUMNS: ColumnSpec[] = [
  { id: "member", width: 221, label: "成员" },
  { id: "skills", width: 124, label: "技能标签" },
  { id: "studentId", width: 92, label: "学号" },
  { id: "className", width: 96, label: "班级" },
  { id: "roles", width: 96, label: "角色" },
  { id: "status", width: 72, label: "状态" },
  { id: "joinedAt", width: 96, label: "加入时间" },
  { id: "repairs", width: 132, label: "维修记录" },
  { id: "contacts", width: 150, label: "联系方式" },
];

/**
 * 列宽偏好的存储键（与主题偏好同一个前缀）。
 * `v2`：第九轮把行首并进首列、列宽改成「相邻两列对冲」，旧的 `index` 列与吸附列语义
 * 都不再适用 —— 旧键里的数字留着只会让人困惑，索性换键重新开始。
 */
const COLUMN_STORAGE_KEY = "zafu-pchospital:admin-columns:members:v2";

const EMPTY_FILTERS: Filters = { query: "", status: "", role: "" };

/**
 * 成员管理（M6 §63）。
 *
 * 页面职责只有「取数 + 排列」：所有状态变更都调 `/api/v1/admin/*`，
 * 由服务端的 Service 层决定规则与审计，前端不做任何权限或状态判断
 * （需求 §41：后端权限校验不能依赖前端按钮是否显示）。
 *
 * 动态渲染出来的表格行**不包 `Reveal`** —— `SiteEffects` 只在挂载时收集一次 `.reveal`，
 * 后插入的元素会永远停在 `opacity: 0`（`docs/design-system.md` §4.6）。
 */
export function MemberAdminPanel() {
  const copy = adminCopy.members;
  /** 必须留在页面上的信息：批量逐条失败明细、重置密码的初始密码（关掉就再也看不到）。 */
  const [message, setMessage] = useState("");
  /** 一次性成功反馈：走顶部浮层，不占布局。 */
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // 取数状态收在 `useAdminList` 里：往下滚动自动接下一页（邮箱式的连续列表，
  // 不再有「上一页 / 下一页」）。筛选变化时由下面的 effect 重置回第一页。
  const list = useAdminList<MemberListEntry>(
    useCallback(
      (targetPage: number) => {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: "20" });
        if (applied.query) params.set("query", applied.query);
        if (applied.status) params.set("status", applied.status);
        if (applied.role) params.set("role", applied.role);
        return adminFetch<MemberListEntry[]>(`/api/v1/admin/members?${params}`);
      },
      [applied],
    ),
  );
  const { items, pagination, state, problem, loadingMore } = list;
  /** 行号从 1 开始，无限下翻时接着往下编（不是「第几页的第几行」）。 */
  const firstRowNumber = 1;
  // 列宽可拖拽（Excel 式全局竖线）：宽度是使用者才清楚的事，写死永远照顾不到所有人。
  const resize = useColumnResize({ storageKey: COLUMN_STORAGE_KEY, columns: COLUMNS });
  // 行首的序号 / 复选框与范围选择（Shift 点击）。
  const rows = useRowSelect({
    ids: items.map((item) => item.id),
    selected,
    onChange: setSelected,
  });
  /* 拖动排序：六点手柄是整张表里唯一可拖的元素（`useRowDragSort`，与技能 / 分类同一套）。
     把 `selected` 传进去 —— 勾选多行时拖动其中任意一行，整块一起移动
     （落点解析会跳过被移动的那几行，见 `movingRowIds`）。 */
  const sort = useRowDragSort(
    items.map((item) => item.id),
    (id, beforeId) => void moveRows(id, beforeId),
    selected,
  );
  /**
   * 页面自己的错误（批量逐条失败的明细、重置密码这类动作的失败）。
   * 与 `list.problem`（取数失败）分开：取数失败要整体换成「重新加载」，动作失败只提示一次。
   */
  const [actionProblem, setProblem] = useState("");
  const shownProblem = actionProblem || problem;

  const load = useCallback(async () => {
    // 换筛选后清空选择：否则「已选 N 名」会与当前列表无关，批量操作容易误伤。
    setSelected([]);
    await list.reload();
  }, [list]);

  useEffect(() => {
    void load();
    // `applied` 变化才重新取第一页；`list` 是稳定引用（内部用 ref 取最新筛选）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setApplied({
      query: (data.query ?? "").trim(),
      status: data.status ?? "",
      role: data.role ?? "",
    });
  }

  /**
   * 拖动排序落点。
   *
   * 三条约定：
   * 1. **乐观更新**：先按 `lib/list-order.ts` 的同一套规则改本地顺序 —— 松手即到位，
   *    不等接口往返（用户反馈「不是立即响应修改的」就是这个等待）。
   * 2. **勾选多行时整块移动**：判断收在 `movingRowIds`，与钩子算落点时用的是同一条规则。
   * 3. **失败回滚**：请求失败就把顺序恢复成改动前的快照并报错，不留一个假顺序。
   *    成功后**不再重取列表** —— 服务端写的就是同一套规则算出来的顺序，重取只会让
   *    已经看到的顺序再闪一次（还会把下翻出来的几页缩回第一页）。
   */
  async function moveRows(draggingId: string, beforeId: string | null) {
    const movingIds = movingRowIds(draggingId, selected);
    setProblem("");
    setToast(null);
    const previous = list.reorder(movingIds, beforeId);
    const result = await adminFetch<{ moved: boolean }>("/api/v1/admin/members/move", {
      method: "POST",
      body: { memberIds: movingIds, beforeId },
    });
    if (!result.ok) {
      list.setOrder(previous);
      setProblem(result.message);
      return;
    }
    if (!result.data.moved) return; // 落点没变：顺序本来就没动，不必提示
    setToast({
      text:
        movingIds.length > 1
          ? copy.table.movedMany.replace("{count}", String(movingIds.length))
          : copy.table.moved,
      tone: "success",
    });
  }

  async function runBatch(enabled: boolean) {
    setBusy(true);
    setMessage("");
    setToast(null);
    setProblem("");
    const result = await adminFetch<MemberBatchToggleResult>("/api/v1/admin/members/batch", {
      method: "POST",
      body: { memberIds: selected, enabled },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (result.data.failed.length === 0) {
      setToast({
        text: `已处理 ${result.data.succeeded.length} 名成员。`,
        // 批量禁用同样用叉：操作成功了，但结果是「关掉」。
        tone: enabled ? "success" : "neutral",
      });
    } else {
      setMessage(
        `${adminShared.batchPartial}成功 ${result.data.succeeded.length} 名，失败 ${result.data.failed.length} 名：${result.data.failed
          .map((item) => `${item.memberId.slice(0, 8)}… ${item.message}`)
          .join("；")}`,
      );
    }
    await load();
  }

  /* 重置密码只在成员详情窗口里做：那里有展示一次性密码的内联区块，
     列表里再放一个按钮等于同一件事两处实现（第七轮：列表的操作列整体撤掉）。 */

  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id));

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-members-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
        {/* 「新增成员」只在顶栏放一个入口（与批量动作同一排），页头不再重复。 */}
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {message ? (
        <p className="admin-status" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {shownProblem ? (
        <p className="admin-status admin-status--error" role="alert">
          {shownProblem}
        </p>
      ) : null}

      <form
        method="post"
        className="admin-filters"
        onSubmit={submitFilters}
        aria-label={copy.filter.submit}
      >
        <div className="admin-filters__row">
          <label className="field">
            <span className="field__label">{copy.filter.query}</span>
            <input
              className="field__input"
              name="query"
              defaultValue={applied.query}
              maxLength={64}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.status}</span>
            <select className="field__input" name="status" defaultValue={applied.status}>
              <option value="">{copy.filter.all}</option>
              {MemberStatus.map((status) => (
                <option key={status} value={status}>
                  {memberStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.filter.role}</span>
            <select className="field__input" name="role" defaultValue={applied.role}>
              <option value="">{copy.filter.all}</option>
              {RoleCode.map((role) => (
                <option key={role} value={role}>
                  {memberRoleLabels[role]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" icon="check">
            {copy.filter.submit}
          </Button>
          <Button variant="ghost" onClick={() => setApplied(EMPTY_FILTERS)}>
            {copy.filter.reset}
          </Button>
        </div>
      </form>

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
          {/* 顶栏常驻（邮箱式）：未选中时动作按钮禁用，因此没有出现/消失，也就没有位移。 */}
          <AdminListToolbar
            count={copy.count.replace("{count}", String(pagination?.total ?? items.length))}
          >
            <AdminBatchTools
              allSelected={allSelected}
              selectAllLabel={copy.table.selectAll}
              onSelectAll={(checked) => setSelected(checked ? items.map((item) => item.id) : [])}
              count={selected.length}
              selectedLabel={copy.batch.selected}
              noneLabel={copy.batch.none}
              clearLabel={copy.batch.clear}
              onClear={() => setSelected([])}
              actions={
                <>
                  <Button
                    disabled={busy || selected.length === 0}
                    onClick={() => void runBatch(true)}
                  >
                    {copy.batch.enable}
                  </Button>
                  <Button
                    disabled={busy || selected.length === 0}
                    onClick={() => void runBatch(false)}
                  >
                    {copy.batch.disable}
                  </Button>
                </>
              }
            />
            <span className="admin-toolbar__sep" aria-hidden="true" />
            <Button variant="solid" icon="plus" onClick={() => setCreating(true)}>
              {copy.create.title}
            </Button>
          </AdminListToolbar>
          <div className="admin-table-wrap admin-table-wrap--resizable">
            {/* `table-layout: fixed` + `<colgroup>`：列宽由用户拖拽决定，
                没有列组的话 fixed 布局会把宽度均分，拖拽就没有意义。
                列宽总和由 `useColumnResize` 保证等于容器宽，因此不需要「吸附列」。 */}
            <table className="admin-table admin-table--resizable" ref={resize.tableRef}>
              <caption className="sr-only">{copy.title}</caption>
              <colgroup>
                {/* 宽度由 React 渲染（首屏、键盘调整、容器变化都靠它），
                    拖动过程中由 `useColumnResize` 直接改这两个属性绕开重渲染。 */}
                {COLUMNS.map((column, index) => (
                  <col
                    key={column.id}
                    ref={resize.colRefs[index]}
                    style={{ width: `${resize.widths[index]}px` }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{copy.table.realName}</th>
                  <th scope="col">{copy.table.skills}</th>
                  <th scope="col">{copy.table.studentId}</th>
                  <th scope="col">{copy.table.className}</th>
                  <th scope="col">{copy.table.roles}</th>
                  <th scope="col">{copy.table.status}</th>
                  <th scope="col">{copy.table.joinedAt}</th>
                  <th scope="col">{copy.table.repairs}</th>
                  <th scope="col">{copy.table.contacts}</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td className="admin-table__empty" colSpan={COLUMNS.length}>
                      {adminShared.empty}
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => (
                    <tr
                      key={item.id}
                      data-row-id={item.id}
                      // 正在拖的行半透明、落点行画一条指示线（`useRowDragSort`）。
                      className={sort.rowClass(item.id)}
                      {...sort.rowProps(item.id)}
                      // 悬停整行即预取该成员的详情与统计：详情窗口要发 3 个 GET，
                      // 提前取回来点「详情」就能直接出内容，不必先看骨架。
                      onMouseEnter={() => prefetchMemberDetail(item.id)}
                    >
                      {/* 首列 = 行首控件 + 姓名 + 昵称 + 「查看」，全都在这一个单元格里。
                          行首不再单独占一列（第九轮验收）：复选框右边缘到姓名之间只剩一个
                          固定间距，不再横着一段空白。
                          六点手柄拖动 = 调整这一行的位置（`useRowDragSort`）。 */}
                      <td className="admin-table__member" data-label={copy.table.realName}>
                        <span className="admin-membercell">
                          <span className="admin-rowhead">
                            {/* 手柄是整行唯一 `draggable` 的元素（整行可拖会让表格里的文字选不中），
                                拖动即调整这一行的位置。HTML5 拖放在触屏上不触发，键盘也拖不动，
                                所以这里同时给它 `role` / `tabIndex` 与 ↑ ↓ 方向键支持。 */}
                            <span
                              className="admin-rowgrip"
                              title={copy.table.dragRow}
                              aria-label={`${copy.table.dragRow}：${item.realName}`}
                              {...sort.handleProps(item.id)}
                              {...sort.keyboardProps(item.id)}
                            >
                              <Icon name="grip" />
                            </span>
                            <span className="admin-rownum">
                              <span className="admin-rownum__n" aria-hidden="true">
                                {firstRowNumber + index}
                              </span>
                              <input
                                aria-label={`${copy.table.selectOne}${item.realName}`}
                                {...rows.checkboxProps(item.id)}
                              />
                            </span>
                          </span>
                          {/* 昵称跟在姓名后面**同一行**：单元格里出现第二行会让行高不一致，
                              整张表看起来参差不齐，也让「每个单元格就是一个字段值」这件事失真
                              （第八轮验收）。用 `（昵称）` 而不是标签样式：标签的描边与内边距
                              在这么窄的一列里太抢眼。 */}
                          <span className="admin-cell__main" title={item.realName}>
                            {item.realName}
                          </span>
                          {item.nickname ? (
                            <span className="admin-cell__aside" title={item.nickname}>
                              （{item.nickname}）
                            </span>
                          ) : null}
                          {/* 详情入口留在首列右端：悬浮整行才出现的小框。
                              用 `opacity` 而不是 `display`：它始终在布局里、始终可聚焦，
                              键盘 Tab 到它时靠 `:focus-visible` 显示 —— 没有出现/消失，就没有位移。 */}
                          <button
                            type="button"
                            className="admin-peek"
                            // 视觉上只有两个字，无障碍名称补上是谁 —— 读屏用户听到的是
                            // 「查看 张三」，而不是十个一模一样的「查看」。
                            aria-label={`${copy.table.view} ${item.realName}`}
                            onClick={() => setDetailId(item.id)}
                          >
                            {copy.table.view}
                          </button>
                        </span>
                      </td>
                      {/* 技能标签紧挨着姓名：这两个字段合起来回答「这是谁、会什么」，
                          原先它们与学号之间隔着一大片空白。 */}
                      <td data-label={copy.table.skills}>
                        {item.skills.length === 0 ? (
                          // 空值统一用 `—`（`adminShared.none`），不要写「未登记」：
                          // 一列四十行都写着「未登记」是噪音，而 `—` 与其余空单元格一致。
                          <span className="admin-cell__muted">{adminShared.none}</span>
                        ) : (
                          <span
                            className="admin-tags"
                            title={item.skills.map((skill) => skill.name).join("、")}
                          >
                            {item.skills.slice(0, SKILL_TAGS_SHOWN).map((skill) => (
                              <span
                                key={skill.id}
                                className={
                                  skill.isActive ? "admin-tag" : "admin-tag admin-tag--muted"
                                }
                              >
                                {skill.name}
                              </span>
                            ))}
                            {item.skills.length > SKILL_TAGS_SHOWN ? (
                              <span className="admin-cell__muted">
                                {copy.table.skillsMore.replace(
                                  "{count}",
                                  String(item.skills.length - SKILL_TAGS_SHOWN),
                                )}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td data-label={copy.table.studentId}>
                        {item.studentId || adminShared.none}
                      </td>
                      {/* 班级名最长 80 字符，不截断会一直挤占姓名列的空间；
                          完整值挂在 `title` 上，鼠标停一下就能看全。 */}
                      <td data-label={copy.table.className} title={item.className ?? undefined}>
                        <span className="admin-cell--ellipsis">
                          {item.className || adminShared.none}
                        </span>
                      </td>
                      <td data-label={copy.table.roles}>
                        <span className="admin-tags">
                          {item.roles.map((role) => (
                            <span
                              className={
                                role === "ADMIN" ? "admin-tag admin-tag--accent" : "admin-tag"
                              }
                              key={role}
                            >
                              {memberRoleLabels[role]}
                              {/* 「账号已停用但管理员角色还在」是角色列的事，不是状态列的事：
                                  放在这里既在同一行说完，也不用把状态列撑宽。 */}
                              {role === "ADMIN" && item.status === "REVOKED" ? (
                                <span className="admin-tag__note">{copy.table.roleStale}</span>
                              ) : null}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td data-label={copy.table.status}>{memberStatusLabels[item.status]}</td>
                      <td data-label={copy.table.joinedAt}>{formatShanghaiDate(item.joinedAt)}</td>
                      {/* 维修次数与总时长合成一格：同一个统计口径（已通过且未删除），
                          分成两列反而要读者自己把两个数字对起来。 */}
                      <td data-label={copy.table.repairs}>
                        <span
                          className={
                            item.approvedRepairCount === 0
                              ? "admin-cell__muted"
                              : "admin-cell__main"
                          }
                        >
                          {copy.table.repairsCount.replace(
                            "{count}",
                            String(item.approvedRepairCount),
                          )}
                        </span>
                        {item.approvedRepairMinutes > 0 ? (
                          <span className="admin-cell__aside">
                            {" · "}
                            {formatDurationMinutes(item.approvedRepairMinutes)}
                          </span>
                        ) : null}
                      </td>
                      <td data-label={copy.table.contacts}>
                        {/* 宽屏并排、窄屏（表格降级成卡片）自动换行，少占一行高度。 */}
                        <span className="admin-contacts">
                          <span>{item.qqMasked ?? adminShared.none}</span>
                          <span>{item.phoneMasked ?? adminShared.none}</span>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {/* Excel 式全局竖线：**放在表格外面**（覆盖层），因此可以贯穿表头与所有行，
                拖动时不必再去表头找那个小柄。位置由 `useColumnResize` 量出来，
                表宽 / 列宽变化时重算。 */}
            <div className="admin-colgrid">
              {resize.boundaries.map((boundary) => (
                <span
                  key={boundary.id}
                  style={{ insetInlineStart: `${boundary.x}px` }}
                  {...resize.lineProps(boundary.id, boundary.label)}
                />
              ))}
            </div>
          </div>
          <AdminListEnd
            pagination={pagination}
            loaded={items.length}
            busy={loadingMore}
            onLoadMore={list.loadMore}
            labels={adminShared.listEnd}
          />
        </div>
      ) : null}

      {detailId ? (
        <MemberDetailPanel
          memberId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      ) : null}

      {/* 新增成员走窗口，不在表格下面追加面板：表格本身有一两千像素高，
          在它下面插入内容用户根本看不见（第六轮验收：「一直以为这个功能是坏的」）。
          创建成功后窗口**不自动关闭** —— 初始密码只出现一次，随窗口消失就等于没发出去。 */}
      {creating ? (
        <AdminModal title={copy.create.title} onClose={() => setCreating(false)}>
          <MemberCreateForm onCreated={() => void load()} onClose={() => setCreating(false)} />
        </AdminModal>
      ) : null}
    </div>
  );
}

/** 预取成员详情窗口需要的三份数据（与 `MemberDetailPanel` 的请求完全一致）。 */
function prefetchMemberDetail(memberId: string) {
  prefetchAdmin(`/api/v1/admin/members/${memberId}`);
  prefetchAdmin(`/api/v1/admin/members/${memberId}/stats`);
  prefetchAdmin("/api/v1/skills");
}
