import { accountEmailCopy } from "@/config/account-email";
import { useRowDragSort } from "@/components/admin/useRowDragSort";
import { useRowSelect } from "@/components/admin/useRowSelect";
import { Icon } from "@/components/ui/Icon";
import { adminCopy, adminShared, memberRoleLabels, memberStatusLabels } from "@/config/admin";
import { formatDurationMinutes } from "@/config/member";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import { memberDepartmentLabels, memberDepartmentOptions } from "@/config/member-department";
import { MemberStatus, type MemberListEntry } from "@/types/contracts";
import type { TableViewSpec } from "@/types/table";

/** 成员表列定义。列 ID 用于持久化列宽；排序与筛选能力须与服务端白名单一致。 */

/** 就地编辑能改的字段。与 `PATCH /api/v1/admin/members/:id` 接受的字段一致。 */
export type MemberEditableFields = { studentId?: string; className?: string };

/** 页面上会被 `render` 用到的运行时值（`<AdminTable renderContext>` 传入）。 */
export type MemberTableContext = {
  /** 行首复选框与范围选择（`useRowSelect` 的返回值原样传入）。 */
  rows: ReturnType<typeof useRowSelect>;
  /** 拖动排序控制器，独立于行勾选。 */
  sort: ReturnType<typeof useRowDragSort>;
  /** 行号从 1 开始：无限下翻时接着往下编，不是「第几页的第几行」。 */
  firstRowNumber: number;
  /** 打开详情窗口。 */
  onView: (memberId: string) => void;
  /**
   * 提交一次就地编辑。面板负责三件事：乐观锁版本号、失败提示、成功后**就地**合并返回值
   * （不整表重取 —— 那会把下翻出来的几页缩回第一页）。抛错表示没成功。
   */
  updateMember: (memberId: string, fields: MemberEditableFields) => Promise<void>;
  /**
   * 当前是否正在按某一列排序。
   *
   * 排序与拖动排序是**两套顺序**，不能同时生效：排序说了算时，行序由服务端排出来，
   * 拖动改不了它。此时手柄必须作废（见下方首列渲染），否则就是一个「看着能拖、
   * 拖了没反应」的假入口。
   */
  sortingActive: boolean;
};

/** 技能标签最多显示几枚（多出来的收成 `+N`，完整列表在这一格的 `title` 上）。 */
const SKILL_TAGS_SHOWN = 2;

/** 禁用是列表里需要优先看见的异常，用危险色描边；在册保持中性。 */
export function memberStatusClass(status: MemberStatus): string {
  return status === "REVOKED" ? "admin-tag admin-tag--danger" : "admin-tag";
}

export const memberTableSpec: TableViewSpec<MemberListEntry, MemberTableContext> = {
  id: "members",
  title: adminCopy.members.title,
  rowKey: (member) => member.id,
  fields: [
    {
      key: "member",
      // 列 id 是「这一格长什么样」，排序字段是 API 的 `realName` —— 两者不是一回事。
      sortKey: "realName",
      // 筛选字段名同理要单独给：这一格里有手柄、姓名、昵称与「查看」，
      // 后端认的只有 `realName`。
      filter: { key: "realName", ops: ["contains"], input: { kind: "text" } },
      label: adminCopy.members.table.realName,
      kind: "text",
      width: 221,
      cellClassName: "admin-table__member",
      render: (member, index, { rows, sort, firstRowNumber, onView, sortingActive }) => (
        // 首列 = 行首控件 + 姓名 + 昵称 + 「查看」，全都在这一个单元格里。
        // 行首不单独占一列：复选框右边缘到姓名之间只剩一个固定间距。
        <span className="admin-membercell">
          <span className="admin-rowhead">
            {sortingActive ? (
              // 排序激活：**槽位保留**（行号与复选框因此不横向移动），但不带任何拖动语义 ——
              // 包括 `aria-label`：读屏不该听到一个拖不动的手柄。
              <span className="admin-rowgrip is-inert" aria-hidden="true" />
            ) : (
              // 手柄是整行唯一 `draggable` 的元素（整行可拖会让表格里的文字选不中），
              // 拖动即调整这一行的位置。HTML5 拖放在触屏上不触发，键盘也拖不动，
              // 所以这里同时给它 `role` / `tabIndex` 与 ↑ ↓ 方向键支持。
              <span
                className="admin-rowgrip"
                title={adminCopy.members.table.dragRow}
                aria-label={`${adminCopy.members.table.dragRow}：${member.realName}`}
                {...sort.handleProps(member.id)}
                {...sort.keyboardProps(member.id)}
              >
                <Icon name="grip" />
              </span>
            )}
            <span className="admin-rownum">
              <span className="admin-rownum__n" aria-hidden="true">
                {firstRowNumber + index}
              </span>
              <input
                aria-label={`${adminCopy.members.table.selectOne}${member.realName}`}
                {...rows.checkboxProps(member.id)}
              />
            </span>
          </span>
          <span className="admin-cell__main" title={member.realName}>
            {member.realName}
          </span>
          {member.nickname ? (
            <span className="admin-cell__aside" title={member.nickname}>
              （{member.nickname}）
            </span>
          ) : null}
          {/* 详情入口留在首列右端：悬浮整行才出现的小框。用 `opacity` 而不是 `display`：
              它始终在布局里、始终可聚焦，键盘 Tab 到它时靠 `:focus-visible` 显示 ——
              没有出现/消失，就没有位移。 */}
          <button
            type="button"
            className="admin-peek"
            // 视觉上只有两个字，无障碍名称补上是谁 —— 读屏用户听到「查看 张三」，
            // 而不是十个一模一样的「查看」。
            aria-label={`${adminCopy.members.table.view} ${member.realName}`}
            onClick={() => onView(member.id)}
          >
            {adminCopy.members.table.view}
          </button>
        </span>
      ),
    },
    {
      key: "department",
      label: adminCopy.members.department,
      kind: "select",
      width: 84,
      sortable: true,
      // 部门列级筛选：枚举 eq/neq，选项与详情/新建表单同一份。
      filter: {
        ops: ["eq", "neq"],
        input: { kind: "enum", options: memberDepartmentOptions },
      },
      render: (member) => memberDepartmentLabels[member.department],
    },
    {
      key: "skills",
      label: adminCopy.members.table.skills,
      kind: "multiSelect",
      width: 124,
      // 关联列：没有可比较的标量，后端白名单里也没有它。
      sortable: false,
      render: (member) =>
        member.skills.length === 0 ? (
          // 空值统一用 `—`：一列四十行都写着「未登记」是噪音，而 `—` 与其余空单元格一致。
          <span className="admin-cell__muted">{adminShared.none}</span>
        ) : (
          <span className="admin-tags" title={member.skills.map((skill) => skill.name).join("、")}>
            {member.skills.slice(0, SKILL_TAGS_SHOWN).map((skill) => (
              <span
                key={skill.id}
                className={skill.isActive ? "admin-tag" : "admin-tag admin-tag--muted"}
              >
                {skill.name}
              </span>
            ))}
            {member.skills.length > SKILL_TAGS_SHOWN ? (
              <span className="admin-cell__muted">
                {adminCopy.members.table.skillsMore.replace(
                  "{count}",
                  String(member.skills.length - SKILL_TAGS_SHOWN),
                )}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: "studentId",
      label: adminCopy.members.table.studentId,
      kind: "text",
      width: 92,
      // 学号按「包含」筛（记得住前几位就够了），不做 `eq`：一个字打错就变成 0 条，
      // 而这种「什么都没有」最难判断是筛错了还是真没有。
      filter: { ops: ["contains"], input: { kind: "text" } },
      // 标量列 ⇒ 可以就地编辑。空值也照改（提交空串服务端会归一成 null）。
      editable: (member, context) => ({
        initial: member.studentId ?? "",
        rowLabel: member.realName,
        commit: (next) => context.updateMember(member.id, { studentId: next }),
      }),
      render: (member) => member.studentId || adminShared.none,
    },
    {
      key: "className",
      label: adminCopy.members.table.className,
      kind: "text",
      width: 96,
      filter: { ops: ["contains"], input: { kind: "text" } },
      // 班级名最长 80 字符，不截断会一直挤占姓名列；完整值挂在 `title` 上。
      title: (member) => member.className ?? undefined,
      editable: (member, context) => ({
        initial: member.className ?? "",
        rowLabel: member.realName,
        commit: (next) => context.updateMember(member.id, { className: next }),
      }),
      render: (member) => (
        <span className="admin-cell--ellipsis">{member.className || adminShared.none}</span>
      ),
    },
    {
      key: "roles",
      label: adminCopy.members.table.roles,
      kind: "multiSelect",
      width: 96,
      sortable: false,
      render: (member) => (
        <span className="admin-tags">
          {member.roles.map((role) => (
            <span
              className={role === "ADMIN" ? "admin-tag admin-tag--accent" : "admin-tag"}
              key={role}
            >
              {memberRoleLabels[role]}
              {/* 「账号已停用但管理员角色还在」是角色列的事，不是状态列的事：
                  放在这里既在同一行说完，也不用把状态列撑宽。 */}
              {role === "ADMIN" && member.status === "REVOKED" ? (
                <span className="admin-tag__note">{adminCopy.members.table.roleStale}</span>
              ) : null}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "status",
      label: adminCopy.members.table.status,
      kind: "select",
      width: 72,
      // 状态列同时留在快捷筛选条里：单值枚举一个下拉最快，那是「常用动作」；
      // 这里多出来的是「不等于某状态」这类快捷条表达不了的条件。
      filter: {
        ops: ["eq", "neq"],
        input: {
          kind: "enum",
          // 选项与展示文案都来自既有的一份（`MemberStatus` + `memberStatusLabels`），
          // 不另抄一遍 —— 状态枚举将来加一项，这里跟着变。
          options: MemberStatus.map((status) => ({
            value: status,
            label: memberStatusLabels[status],
          })),
        },
      },
      render: (member) => (
        <span className="admin-tags">
          <span className={memberStatusClass(member.status)}>
            {memberStatusLabels[member.status]}
          </span>
        </span>
      ),
    },
    {
      key: "joinedAt",
      label: adminCopy.members.table.joinedAt,
      kind: "date",
      width: 96,
      numeric: false,
      // 日期区间：两条条件（大于等于 + 小于等于）就是闭区间，不做专门的「区间」控件 ——
      // 那需要另一套状态与另一套契约，而两条条件已经能表达同一件事。
      // 边界按**上海自然日**算（后端 `parseUtcDateFilter`），因此选同一天起止能筛到当天的记录。
      filter: { ops: ["gte", "lte"], input: { kind: "date" } },
      render: (member) => formatShanghaiDate(member.joinedAt),
    },
    {
      key: "repairs",
      label: adminCopy.members.table.repairs,
      kind: "readonly",
      width: 132,
      numeric: false,
      sortable: false,
      // 维修次数与总时长合成一格：同一个统计口径（已通过且未删除），分成两列反而要
      // 读者自己把两个数字对起来。
      render: (member) => (
        <>
          <span
            className={member.approvedRepairCount === 0 ? "admin-cell__muted" : "admin-cell__main"}
          >
            {adminCopy.members.table.repairsCount.replace(
              "{count}",
              String(member.approvedRepairCount),
            )}
          </span>
          {member.approvedRepairMinutes > 0 ? (
            <span className="admin-cell__aside">
              {" · "}
              {formatDurationMinutes(member.approvedRepairMinutes)}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "contacts",
      label: adminCopy.members.table.contacts,
      kind: "text",
      width: 150,
      // 脱敏后的拼接展示值，不是可比较的标量。
      sortable: false,
      render: (member) => (
        // 宽屏并排、窄屏（表格降级成卡片）自动换行，少占一行高度。
        <span className="admin-contacts">
          <span>{member.qqMasked ?? adminShared.none}</span>
          <span>{member.phoneMasked ?? adminShared.none}</span>
          <span>
            {member.emailMasked ?? accountEmailCopy.unbound} ·{" "}
            {member.emailVerified ? accountEmailCopy.verified : accountEmailCopy.unbound}
          </span>
        </span>
      ),
    },
  ],
};
