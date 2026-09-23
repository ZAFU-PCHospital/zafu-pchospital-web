import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared } from "@/config/admin";
import { formatDurationMinutes, formatShanghaiDate } from "@/config/member";
import { repairResultLabels, repairStatusLabels } from "@/config/repairs";
import { UNCATEGORIZED_LABEL } from "@/types/contracts";
import type { RepairView } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/**
 * 维修记录表的视图定义（后台表格内核的第三个落地页，也是列最多、最需要排序的一张）。
 *
 * 与成员表不同的是：**首列是独立的选择列**（表头空、没有字段名），
 * 选择逻辑也留在面板里（这张表没走 `useRowSelect`，是自己维护的 `selected`）。
 * 迁移只把渲染搬过来，交互照旧。
 *
 * 四处逐字照抄、不要顺手「优化」：
 *
 * 1. **不声明列宽**：这张表也没接 `useColumnResize`，列宽由浏览器按内容分配；
 * 2. **选择列没有字段名**：表头写空串 `label: ""`。迁移前这段手写标记里还写了一个
 *    `data-label=""`，内核统一成「没有字段名就不写这个属性」—— 卡片模式里
 *    `attr(data-label)` 取不到属性与取到空串渲染完全相同（`content` 都是空串，
 *    那个 5.5rem 的标签格照样占位），因此像素不动；技能 / 分类两张表的手柄列
 *    原本就没有这个属性，统一之后三张表逐字等价；
 * 3. **「成员」列是内容列**（`admin-table__grow`）：表头与单元格都带，吸收剩余宽度并允许换行；
 * 4. **日期与时长列不开右对齐**：内核按类型默认会加 `admin-table__num`，这里显式关掉。
 *
 * 排序：白名单与后端 `REPAIR_SORTABLE` 一一对应（`sortKey`）。列 id 与 API 字段不同的
 * 两列单独标了 `sortKey` —— `member` → `memberName`、`category` → `categoryName`，
 * 后端按**名字**排（按 UUID 排对使用者没有意义）。
 *
 * 「疑难」「典型」两个标签目前是硬编码中文（面板里原本就是写死的），这里原样保留；
 * 搬进 `src/config/` 属于文案清理，与本轮迁移分开做，免得 diff 里混进文案改动。
 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type RepairTableContext = {
  /** 已勾选的记录 id。 */
  selected: string[];
  /** 勾选 / 取消勾选一行（值由调用方在事件里先取出，避免 `currentTarget` 失效）。 */
  onToggleSelected: (recordId: string, checked: boolean) => void;
  /** 打开这一行的详情窗口。 */
  onDetail: (recordId: string) => void;
};

const copy = adminCopy.repairs;

export const repairTableSpec: TableViewSpec<RepairView, RepairTableContext> = {
  id: "repairs",
  title: copy.title,
  rowKey: (record) => record.id,
  fields: [
    {
      key: "select",
      // 选择列没有字段名：表头为空，内核因此不写 `data-label`。
      label: "",
      kind: "readonly",
      sortable: false,
      render: (record, _index, { selected, onToggleSelected }) => (
        <input
          className="admin-check"
          type="checkbox"
          aria-label={copy.table.selectOne}
          checked={selected.includes(record.id)}
          // `event.currentTarget` 只在事件派发期间有效：把它读进 state updater 里会在
          // updater 真正执行时变成 null 并抛 `Cannot read properties of null (reading
          // 'checked')`（浏览器实测踩到）。所以先取值再交给回调。
          onChange={(event) => onToggleSelected(record.id, event.currentTarget.checked)}
        />
      ),
    },
    {
      key: "repairDate",
      label: copy.table.repairDate,
      kind: "date",
      numeric: false,
      render: (record) => formatShanghaiDate(record.repairDate),
    },
    {
      key: "member",
      // 列 id 描述「这一格显示谁」，排序字段是 API 的 `memberName`。
      sortKey: "memberName",
      label: copy.table.member,
      kind: "text",
      headClassName: "admin-table__grow",
      cellClassName: "admin-table__grow",
      render: (record) => record.member.name,
    },
    {
      key: "category",
      sortKey: "categoryName",
      label: copy.table.category,
      kind: "select",
      render: (record) => record.category?.name ?? UNCATEGORIZED_LABEL,
    },
    {
      key: "result",
      label: copy.table.result,
      kind: "select",
      render: (record) => (record.result ? repairResultLabels[record.result] : adminShared.none),
    },
    {
      key: "duration",
      sortKey: "durationMinutes",
      label: copy.table.duration,
      kind: "number",
      numeric: false,
      render: (record) =>
        record.durationMinutes === null
          ? adminShared.none
          : formatDurationMinutes(record.durationMinutes),
    },
    {
      key: "status",
      label: copy.table.status,
      kind: "select",
      render: (record) => (
        <>
          <span className={`repair-tag repair-tag--${record.status.toLowerCase()}`}>
            {repairStatusLabels[record.status]}
          </span>
          {record.isDifficult ? <span className="admin-tag">疑难</span> : null}
          {record.isTypical ? <span className="admin-tag admin-tag--accent">典型</span> : null}
        </>
      ),
    },
    {
      key: "actions",
      label: copy.table.actions,
      kind: "readonly",
      sortable: false,
      render: (record, _index, { onDetail }) => (
        <span className="admin-actions">
          <Button variant="ghost" onClick={() => onDetail(record.id)}>
            {copy.action.detail}
          </Button>
        </span>
      ),
    },
  ],
};
