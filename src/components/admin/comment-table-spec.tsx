import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared } from "@/config/admin";
import { repairStatusLabels } from "@/config/repairs";
import type { AdminCommentEntry } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/**
 * 评论表的视图定义（后台表格内核的第六个落地页：成员 → 审计 → 维修 → 邀请码 → 招募 → 评论）。
 *
 * 迁移只做一件事：把面板里「表头 7 个 `<th>` + `tbody` 里 7 个 `<td>`」这两份平行定义
 * 收进一份 spec。**渲染逐字照抄**，几处刻意保持原样、不要顺手「优化」：
 *
 * 1. **不声明列宽**：评论表从来没接过 `useColumnResize`，列宽由浏览器按内容分配。
 *    内核因此在没有列宽时不输出 `<colgroup>` —— 迁移不该顺带改掉它的布局；
 * 2. **「评论内容」列是内容列**（`admin-table__grow`）：表头与单元格都要带，
 *    它让这一列吸收剩余宽度并允许换行；
 * 3. **「发表时间」列不开右对齐**：内核按 `datetime` 类型默认会给 `admin-table__num`，
 *    而迁移前这一列没有右对齐。是否改成右对齐是产品决定，不在这件事里顺手做；
 * 4. **「所属记录」「回复 / 提及」两格是复合单元格**（关联记录 + 日期 + 审核状态、
 *    两枚派生计数），因此 `kind` 用 `readonly`：它们是投影出来的展示值，不是可编辑字段。
 *
 * 排序说明：评论列表的接口没有 `sort` 参数（服务端固定按发表时间倒序），所以面板
 * **不传 `onSortChange`** —— 内核在不传时不渲染任何排序控件，DOM 与迁移前完全一致。
 * 要开排序得先按 `docs/admin-table-kernel.md` §6 的形状贯通后端白名单。
 */

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type CommentTableContext = {
  /**
   * 删除请求在飞。
   *
   * 放在 context 里而不是 spec 闭包捕获：spec 必须是模块级常量，否则它的引用会随
   * 「有没有请求在飞」变化，以 spec 派生的列清单为依赖的列宽逻辑会跟着重跑。
   */
  busy: boolean;
  /** 打开这一行所属维修记录的窗口（复用维修审核的记录窗口）。 */
  onOpenRecord: (recordId: string) => void;
  /** 弹出删除确认框：删除是软删除，必须二次确认，不能点一下就落库。 */
  onRemove: (entry: AdminCommentEntry) => void;
};

const copy = adminCopy.comments;

export const commentTableSpec: TableViewSpec<AdminCommentEntry, CommentTableContext> = {
  id: "comments",
  title: copy.title,
  rowKey: (entry) => entry.id,
  fields: [
    {
      key: "body",
      label: copy.table.body,
      kind: "longText",
      headClassName: "admin-table__grow",
      cellClassName: "admin-table__grow",
      render: (entry) => <span className="admin-comment__body">{entry.body}</span>,
    },
    {
      key: "author",
      label: copy.table.author,
      kind: "text",
      render: (entry) => entry.author.name,
    },
    {
      key: "record",
      label: copy.table.record,
      kind: "readonly",
      render: (entry) => (
        <>
          {entry.record.memberName}
          {/* 日期与审核状态排在同一行的副行里：这一格要回答的是「这条评论挂在谁、
              哪一天、什么状态的记录上」，拆成三列会把表格拉宽一倍。 */}
          <span className="repair-table__flags">
            {entry.record.repairDate ?? adminShared.none} ·{" "}
            {repairStatusLabels[entry.record.status]}
          </span>
        </>
      ),
    },
    {
      key: "meta",
      label: copy.table.meta,
      kind: "readonly",
      render: (entry) => (
        <>
          {copy.meta.replies.replace("{count}", String(entry.replyCount))} ·{" "}
          {copy.meta.mentions.replace("{count}", String(entry.mentionCount))}
        </>
      ),
    },
    {
      key: "createdAt",
      label: copy.table.createdAt,
      kind: "datetime",
      // 与迁移前一致：这一列没有 `admin-table__num`（不右对齐）。
      numeric: false,
      render: (entry) => formatDateTime(entry.createdAt),
    },
    {
      key: "state",
      label: copy.table.state,
      kind: "select",
      // 两个标签成对出现：已删除走中性色（它不再是一条生效中的数据），
      // 未删除走结果色。软删除后评论仍在库里，界面必须两种状态都看得见。
      render: (entry) =>
        entry.deletedAt ? (
          <span className="admin-tag admin-tag--muted">{copy.deletedTag}</span>
        ) : (
          <span className="repair-tag repair-tag--result">{copy.activeTag}</span>
        ),
    },
    {
      key: "actions",
      label: copy.table.actions,
      kind: "readonly",
      render: (entry, _index, { busy, onOpenRecord, onRemove }) => (
        <span className="admin-actions">
          <Button variant="ghost" onClick={() => onOpenRecord(entry.record.id)}>
            {copy.action.record}
          </Button>
          {/* 删除只留图标：原先「图标 + 删除」两个字之间被按钮的 `gap` 拉开，
              在一列窄操作区里显得很散。文字改成不可见标签，无障碍名称仍然完整。
              已删除的评论不能再删一次，请求在飞时也禁用（避免连点产生两次软删除）。 */}
          <Button
            variant="ghost"
            icon="trash"
            disabled={busy || entry.deletedAt !== null}
            onClick={() => onRemove(entry)}
          >
            <span className="sr-only">{copy.action.remove}</span>
          </Button>
        </span>
      ),
    },
  ],
};

/**
 * 列表里的时间：`Asia/Shanghai` 的 `MM-DD HH:mm`，表格列窄，不重复显示年份。
 *
 * 从 `CommentAdminPanel` 里**逐字搬过来**（spec 要用，留在面板里会让 spec 反过来
 * import 组件）。其余面板各自都有一份同样的拷贝，统一它们与本轮迁移无关
 * （见 `src/config/audit.ts` 里的同一笔记录），所以这里不顺手改。
 */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
