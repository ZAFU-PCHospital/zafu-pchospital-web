import type { NavItem } from "@/config/navigation";
import {
  EXPORT_MAX_ROWS,
  type CommentModerationFilter,
  type InviteCodeEffectiveStatus,
  type JoinApplicationStatus,
  type MemberStatus,
  type ProvisionStatus,
  type RankingDisplayNameMode,
  type RoleCode,
} from "@/types/contracts";

/**
 * 管理后台的文案与导航（M6）。
 *
 * 为什么单独一份、**不并入 `src/config/navigation.ts` 的 `mainNav`**：
 * `Header` 的桌面索引栏与移动端浮层都以 `mainNav` 为唯一数据源，加进去
 * `/admin/*` 会立刻出现在全站公开导航里。后台入口只在后台内部使用。
 *
 * 章节编号沿用站点既有约定（公开页 01–04、成员页 05–08），后台从 **09** 起。
 * 批 1 占 09–12，批 2 占 13–18。
 */
export const ADMIN_SECTION_INDEX = {
  home: "00",
  members: "09",
  repairs: "10",
  categories: "11",
  export: "12",
  skills: "13",
  comments: "14",
  inviteCodes: "15",
  recruitment: "16",
  audit: "17",
  settings: "18",
} as const;

export const adminNav: readonly NavItem[] = [
  {
    index: ADMIN_SECTION_INDEX.members,
    label: "成员管理",
    shortLabel: "成员",
    labelEn: "Members",
    href: "/admin/members",
  },
  {
    index: ADMIN_SECTION_INDEX.repairs,
    label: "维修审核",
    shortLabel: "审核",
    labelEn: "Repairs",
    href: "/admin/repairs",
  },
  {
    index: ADMIN_SECTION_INDEX.categories,
    label: "故障分类",
    shortLabel: "分类",
    labelEn: "Categories",
    href: "/admin/categories",
  },
  {
    index: ADMIN_SECTION_INDEX.export,
    label: "数据导出",
    shortLabel: "导出",
    labelEn: "Export",
    href: "/admin/export",
  },
  {
    index: ADMIN_SECTION_INDEX.skills,
    label: "技能标签",
    shortLabel: "技能",
    labelEn: "Skills",
    href: "/admin/skills",
  },
  {
    index: ADMIN_SECTION_INDEX.comments,
    label: "评论管理",
    shortLabel: "评论",
    labelEn: "Comments",
    href: "/admin/comments",
  },
  {
    index: ADMIN_SECTION_INDEX.inviteCodes,
    label: "邀请码",
    shortLabel: "邀请码",
    labelEn: "Invite",
    href: "/admin/invite-codes",
  },
  {
    index: ADMIN_SECTION_INDEX.recruitment,
    label: "招募审核",
    shortLabel: "招募",
    labelEn: "Recruitment",
    href: "/admin/join-applications",
  },
  {
    index: ADMIN_SECTION_INDEX.audit,
    label: "审计记录",
    shortLabel: "审计",
    labelEn: "Audit",
    href: "/admin/audit",
  },
  {
    index: ADMIN_SECTION_INDEX.settings,
    label: "公开统计",
    shortLabel: "设置",
    labelEn: "Settings",
    href: "/admin/settings",
  },
] as const;

export const memberStatusLabels: Record<MemberStatus, string> = {
  ACTIVE: "在册",
  REVOKED: "已禁用",
};

export const memberRoleLabels: Record<RoleCode, string> = {
  MEMBER: "成员",
  ADMIN: "管理员",
};

/** 报名状态标签（需求 §11.2）。M6 批 2 的招募审核页与报名导出共用。 */
export const joinApplicationStatusLabels: Record<JoinApplicationStatus, string> = {
  SUBMITTED: "已提交",
  INTERVIEW_PENDING: "待面试",
  INTERVIEW_PASSED: "面试通过",
  INTERVIEW_REJECTED: "面试未通过",
  WITHDRAWN: "已撤回",
};

/** 账号发放状态标签（需求 §11.4 / §39.5）。 */
export const provisionStatusLabels: Record<ProvisionStatus, string> = {
  NOT_REQUIRED: "无需发放",
  PENDING: "待发放",
  SUCCEEDED: "已发放",
  FAILED: "发放失败",
};

/** 邀请码生效状态标签。`InviteCodeEffectiveStatus` 是派生的，不是库里的存储状态。 */
export const inviteCodeStatusLabels: Record<InviteCodeEffectiveStatus, string> = {
  NOT_STARTED: "未生效",
  ACTIVE: "可用",
  REVOKED: "已撤销",
  EXPIRED: "已过期",
  EXHAUSTED: "已用尽",
};

/** 排行榜展示名策略标签（需求 §74）。 */
export const rankingDisplayNameLabels: Record<RankingDisplayNameMode, string> = {
  REAL_NAME: "真实姓名",
  NICKNAME: "仅昵称",
  HIDDEN: "隐藏",
};

export const commentDeletedLabels: Record<CommentModerationFilter, string> = {
  ACTIVE: "未删除",
  DELETED: "已删除",
  ALL: "全部",
};

/** 共享措辞：所有后台页面用同一套加载/失败/空态文案，避免每个页面各写一遍。 */
export const adminShared = {
  loading: "正在加载…",
  reload: "重新加载",
  loadFailed: "加载失败，请稍后重试",
  submitting: "提交中…",
  empty: "暂无数据。",
  forbidden: "当前账号没有执行该操作的权限。",
  sessionExpired: "登录状态已失效，请重新登录。",
  batchPartial: "部分操作未成功，请查看逐条结果。",
  close: "关闭",
  /** 一次性流程的收尾按钮（例如「新增成员」拿到初始密码之后）。 */
  done: "完成",
  cancel: "取消",
  toastClose: "关闭提示",
  previousPage: "上一页",
  nextPage: "下一页",
  /** 分页条中间那格：`{page} / {totalPages}`。 */
  paginationSummary: "{page} / {totalPages}",
  /** 统一的人名缺失占位：表格里不该出现空白单元格。 */
  unknownMember: "成员",
  none: "—",
  /**
   * 列级筛选弹层的文案（内核，各表共用）。
   *
   * 列名**不在这里**：它来自 spec 的 `FieldSpec.label`（表头与筛选下拉共用同一份），
   * 否则「表头叫成员、筛选里叫姓名」这种漂移迟早出现。
   */
  filters: {
    open: "列筛选",
    /** 按钮的无障碍名称：带上有几个条件在生效，读屏用户不必打开弹层去数。 */
    openActive: "列筛选（{count} 个条件生效中）",
    title: "列筛选条件",
    lead: "按某一列加条件，多条之间是「并且」。它与上面的快捷筛选、关键字搜索同时生效。",
    field: "列",
    op: "运算符",
    value: "值",
    pick: "请选择",
    add: "添加条件",
    remove: "删除这条条件",
    empty: "还没有条件。点「添加条件」选一列开始。",
    apply: "应用",
    reset: "清空条件",
    /** 有没填完的条件时「应用」是灰的，这句话说明为什么。 */
    incomplete: "每一条都要选好列、运算符和值才能应用。",
    limit: "最多 {count} 条条件。",
    ops: {
      eq: "等于",
      neq: "不等于",
      contains: "包含",
      // 日期列也用这两条（读作「大于等于 2026-01-01」）；数字列同样成立，
      // 因此不按字段类型分两套文案。
      gte: "大于等于",
      lte: "小于等于",
    },
  },
  /** 无限下翻列表的末尾文案。`{loaded}` / `{total}` 由 `AdminListEnd` 替换。 */
  listEnd: {
    // 顶栏右侧已经写了「共 N 条记录」，这里再说一次总数就是同一句话连着出现两遍
    // （第五轮验收）。列表到底只需要一个「没有更多了」的信号，不再重复数字。
    loaded: "已加载 {loaded} / 共 {total} 条",
    all: "已全部加载",
    more: "加载更多",
    loading: "加载中…",
  },
} as const;

export const adminCopy = {
  title: "管理后台",
  /** 侧栏品牌区的英文小字（与站点其它地方的 `eyebrow` 同一处理）。 */
  titleEn: "Admin Console",
  navLabel: "管理后台导航",
  home: {
    label: "Admin",
    lead: "成员、维修审核、分类、技能、评论、邀请码、招募、导出、审计与公开统计的统一入口。所有操作在服务端鉴权，并写入审计记录。",
    sections: [
      {
        index: ADMIN_SECTION_INDEX.members,
        title: "成员管理",
        description: "新增与编辑成员、设置角色与技能标签、禁用启用、重置密码、批量操作。",
        href: "/admin/members",
      },
      {
        index: ADMIN_SECTION_INDEX.repairs,
        title: "维修审核",
        description: "查看与筛选全部记录、审核通过与退回、修改异常数据、软删除、标记案例。",
        href: "/admin/repairs",
      },
      {
        index: ADMIN_SECTION_INDEX.categories,
        title: "故障分类",
        description: "新增、修改、停用与恢复故障分类；有历史记录的分类只停用不删除。",
        href: "/admin/categories",
      },
      {
        index: ADMIN_SECTION_INDEX.export,
        title: "数据导出",
        description: "按与列表相同的筛选条件导出维修记录，支持 CSV 与 Excel。",
        href: "/admin/export",
      },
      {
        index: ADMIN_SECTION_INDEX.skills,
        title: "技能标签",
        description: "维护成员可选的技能标签库；已被选用的标签只停用不删除。",
        href: "/admin/skills",
      },
      {
        index: ADMIN_SECTION_INDEX.comments,
        title: "评论管理",
        description: "查看全部维修记录的内部评论，确认评论所属记录，删除违规内容。",
        href: "/admin/comments",
      },
      {
        index: ADMIN_SECTION_INDEX.inviteCodes,
        title: "邀请码",
        description: "创建、调整有效期与使用次数、撤销邀请码；完整邀请码只在创建时显示一次。",
        href: "/admin/invite-codes",
      },
      {
        index: ADMIN_SECTION_INDEX.recruitment,
        title: "招募审核",
        description: "查看与筛选报名、登记面试结果、跟进账号发放、导出报名数据。",
        href: "/admin/join-applications",
      },
      {
        index: ADMIN_SECTION_INDEX.audit,
        title: "审计记录",
        description: "按动作、目标、操作者与时间检索重要操作留痕；审计只读，不可修改或删除。",
        href: "/admin/audit",
      },
      {
        index: ADMIN_SECTION_INDEX.settings,
        title: "公开统计",
        description: "配置官网首页公开的维修统计、排行榜开关与排行榜展示名策略。",
        href: "/admin/settings",
      },
    ],
  },
  members: {
    label: "Members",
    title: "成员管理",
    /* 短句，且不再解释脱敏与审计的实现细节 —— 那是系统行为，不是管理员要先读的说明书。
       界面自己会把脱敏值显示出来（`138****1234`），详情里也标了「会写审计」。 */
    lead: "管理成员身份与角色。打开详情显示具体信息。",
    filter: {
      query: "姓名 / 昵称 / 学号 / 班级 / QQ / 手机号",
      status: "成员状态",
      role: "角色",
      all: "全部",
      submit: "筛选",
      reset: "清除筛选",
    },
    table: {
      realName: "成员",
      studentId: "学号",
      className: "班级",
      skills: "技能标签",
      roles: "角色",
      status: "状态",
      joinedAt: "加入时间",
      /** 维修统计列：次数 + 总时长合成一格。 */
      repairs: "维修记录",
      repairsCount: "{count} 次",
      approvedRepairCount: "已通过维修",
      contacts: "联系方式",
      actions: "操作",
      selectAll: "全选本页",
      selectOne: "选择该成员",
      /** 首列右端的详情入口（悬浮整行时出现的小框）。 */
      view: "查看",
      /** 行首六点手柄：拖动即调整这一行的位置（`useRowDragSort`）。 */
      dragRow: "拖动调整这一行的位置",
      /** 拖动落点写库成功后的浮层提示（单行 / 整块两种说法）。 */
      moved: "已调整该成员的顺序。",
      movedMany: "已把 {count} 位成员一起移动到新位置。",
      /** 账号已停用但管理员角色仍在：跟在角色标签后面，同一行说完。 */
      roleStale: "· 已停用",
      /** 技能标签超过 2 枚时收成 `+N`；完整列表在这一格的 `title` 上。 */
      skillsMore: "+{count}",
    },
    action: {
      detail: "详情",
      edit: "编辑",
      resetPassword: "重置密码",
      disable: "禁用",
      enable: "启用",
    },
    /** 列表顶栏右侧的总数。 */
    count: "共 {count} 名成员",
    batch: {
      selected: "已选择 {count} 名成员",
      /** 未选中时顶栏显示的状态（按钮同时是禁用态，所以这里是陈述而不是提示）。 */
      none: "未选择成员",
      disable: "批量禁用",
      enable: "批量启用",
      clear: "取消选择",
    },
    create: {
      title: "新增成员",
      realName: "姓名",
      qq: "QQ 号",
      phone: "手机号",
      studentId: "学号",
      className: "班级",
      nickname: "昵称",
      submit: "创建成员",
      optional: "选填",
      hint: "QQ 号 5–11 位数字；手机号 11 位中国大陆号码。初始密码只在创建成功后显示一次。",
      created: "成员已创建，请立即把初始密码交给本人：",
      secretOnce: "初始密码只显示这一次，关闭后无法再次查看，只能重置。",
      /** 服务端没回初始密码时的兜底文案（正常路径不会出现）。 */
      secretMissing: "服务端未返回初始密码，请用「重置密码」重新生成。",
    },
    edit: {
      title: "编辑成员资料",
      submit: "保存修改",
      saved: "成员资料已保存。",
      /** 启用/禁用不再是「资料已保存」：那是另一件事，反馈要说清楚做的是什么。 */
      disabled: "成员已禁用。",
      enabled: "成员已重新启用。",
      cancel: "收起",
    },
    roles: {
      title: "角色",
      submit: "保存角色",
      saved: "角色已更新。",
      hint: "不允许撤销最后一个在册管理员。",
    },
    skills: {
      title: "技能标签",
      submit: "保存技能标签",
      saved: "技能标签已更新。",
      /** 标签选择器文案（`{count}` / `{name}` / `{limit}` 由组件替换）。 */
      empty: "还没有选择技能标签",
      remaining: "还可以添加 {count} 个",
      remove: "移除标签 {name}",
      inactive: "已停用",
      limitReached: "已达上限 {limit} 个，先移除一个再加。",
    },
    detail: {
      title: "成员详情",
      contacts: "联系方式",
      contactsNote: "查看明文联系方式会写入审计记录。",
      stats: "维修统计",
      statsUnavailable: "维修统计暂时不可用（不影响其它管理操作）。",
    },
    resetResult: {
      title: "密码已重置，请立即交给本人：",
      /** 浮层里用短句：新密码本身显示在窗口内，浮层不该以冒号结尾。 */
      toast: "密码已重置，新密码见窗口下方。",
      note: "重置后该账号的登录会话已全部失效，且首次登录必须改密。",
    },
  },
  repairs: {
    label: "Repairs",
    title: "维修审核",
    lead: "查看全部成员提交的维修记录，完成审核、退回、异常数据修正与案例标记。",
    filter: {
      query: "内容 / 备注 / 成员",
      status: "审核状态",
      result: "维修结果",
      category: "故障分类",
      dateFrom: "起始日期",
      dateTo: "结束日期",
      difficult: "疑难案例",
      typical: "典型案例",
      all: "全部",
      submit: "筛选",
      reset: "清除筛选",
    },
    table: {
      repairDate: "维修日期",
      member: "成员",
      category: "故障分类",
      result: "维修结果",
      duration: "维修时长",
      status: "状态",
      flags: "标记",
      actions: "操作",
      selectAll: "全选本页",
      selectOne: "选择该记录",
    },
    action: {
      detail: "详情",
      approve: "通过",
      reject: "退回",
      edit: "修改数据",
      remove: "软删除",
      flags: "案例标记",
    },
    /** 列表顶栏右侧的总数。 */
    count: "共 {count} 条记录",
    batch: {
      selected: "已选择 {count} 条记录",
      none: "未选择记录",
      approve: "批量通过",
      reject: "批量退回",
      /** 批量退回弹层里的确认按钮；数量由 `selected` 那句在弹层里说明。 */
      rejectSubmit: "确认批量退回",
      clear: "取消选择",
    },
    review: {
      rejectTitle: "退回原因",
      rejectHint: "退回必须填写原因，会同时通知提交人。",
      notePlaceholder: "说明需要申请人补充或修正的内容",
      submit: "确认退回",
      cancel: "取消",
    },
    edit: {
      title: "修改异常数据",
      reason: "修改原因",
      reasonHint: "必填。会写入记录时间线与审计，说明「为什么改」。",
      submit: "保存修改",
      saved: "记录已更新，审核状态未改变。",
      categoryInactive: "已停用的分类不能作为新值。",
    },
    removePanel: {
      title: "软删除记录",
      reason: "删除原因",
      hint: "软删除不会物理删除数据，统计口径会立即排除该记录。",
      submit: "确认软删除",
      done: "记录已软删除。",
      cancel: "取消",
    },
    flags: {
      title: "案例标记",
      difficult: "标记为疑难案例",
      typical: "标记为典型案例",
      submit: "保存标记",
      saved: "标记已更新。",
    },
    detail: {
      title: "记录详情",
      photos: "维修照片",
      photosEmpty: "这条记录没有上传照片。",
      photosOpen: "在新标签打开原图",
      photoUnavailable: "照片暂时不可读取",
    },
  },
  categories: {
    label: "Categories",
    title: "故障分类",
    lead: "维护故障分类。已被维修记录引用过的分类只能停用，不做物理删除。",
    table: {
      name: "名称",
      description: "说明",
      usage: "引用记录",
      state: "状态",
      actions: "操作",
    },
    state: { active: "启用中", inactive: "已停用" },
    action: {
      edit: "编辑",
      save: "保存",
      cancel: "取消",
      deactivate: "停用",
      activate: "启用",
      moveUp: "上移",
      moveDown: "下移",
      /** 行首拖动排序手柄的无障碍名称。 */
      drag: "拖动调整顺序",
    },
    create: {
      title: "新增分类",
      name: "名称",
      nameHint: "例如「散热 / 清灰」。标识由系统按名称生成，不需要填写。",
      description: "说明",
      submit: "新增分类",
      created: "分类已创建。",
      conflict: "该分类名称已存在，请换一个。",
    },
    updated: "分类已更新。",
    deactivated: "分类已停用。",
    activated: "分类已启用。",
    reordered: "顺序已调整。",
    usageNote: "引用记录数大于 0 的分类不能删除，只能停用。",
    orderNote: "列表顺序就是维修表单里分类下拉的顺序：拖动行首的手柄即可调整，键盘用每行的 ↑ ↓。",
  },
  export: {
    label: "Export",
    title: "数据导出",
    lead: "按与维修列表相同的筛选条件导出记录。图片不嵌入表格，只输出记录 ID 与照片链接。",
    filter: {
      query: "内容 / 备注 / 成员",
      status: "审核状态",
      result: "维修结果",
      category: "故障分类",
      dateFrom: "起始日期",
      dateTo: "结束日期",
      all: "全部",
    },
    format: {
      label: "导出格式",
      csv: "CSV（Excel 可直接打开）",
      xlsx: "Excel（.xlsx）",
    },
    submit: "导出",
    note: `行数上限 ${EXPORT_MAX_ROWS} 条：超过会直接拒绝而不是截断，请缩小筛选范围。导出会写入审计记录。`,
    done: "已开始下载，共 {count} 条记录。",
    /* 空结果必须说清楚「为什么空」。曾经有过一次误判：导出确实拿到了 0 行，
       但界面只回了「已开始下载」，用户打开文件才发现是空表，只能猜是功能坏了。
       现在改成：先按同样的筛选条件统计条数（列表接口的 `pagination.total`），
       0 条时**不落文件**，并把当时生效的筛选条件原样列出来。 */
    preview: {
      loading: "正在统计匹配条数…",
      count: "当前筛选条件匹配 {count} 条记录。",
      zero: "当前筛选条件匹配 0 条记录，导出的文件会是空的。",
      failed: "匹配条数统计失败：{message}",
    },
    emptyFiltered: "没有匹配的维修记录，未生成文件。当时生效的筛选条件：{filters}",
    emptyNoFilter: "当前没有任何可导出的维修记录，未生成文件。",
    columns:
      "导出列：维修日期、维修成员、故障分类、维修结果、维修时长、审核状态、创建时间、记录 ID、维修照片链接。",
  },
  /* ------------------------------------------------------------------ 批 2 */
  skills: {
    label: "Skills",
    title: "技能标签",
    lead: "维护成员可选择的技能标签库。已被成员选用的标签只能停用，不做物理删除。",
    table: {
      name: "名称",
      description: "说明",
      usage: "选用成员",
      state: "状态",
      actions: "操作",
    },
    state: { active: "启用中", inactive: "已停用" },
    action: {
      edit: "编辑",
      save: "保存",
      cancel: "取消",
      deactivate: "停用",
      activate: "启用",
      moveUp: "上移",
      moveDown: "下移",
      /** 行首拖动排序手柄的无障碍名称（手柄本身是装饰性的，见 `SkillAdminPanel`）。 */
      drag: "拖动调整顺序",
    },
    /* 「代码」「排序」两个字段不再让管理员填：
       前者是系统的稳定标识（按名称自动生成），后者靠拖动行首手柄调整（键盘用 ↑ ↓）。 */
    create: {
      title: "新增技能标签",
      name: "名称",
      nameHint: "例如「笔记本拆装」。标识由系统按名称生成，不需要填写。",
      description: "说明",
      submit: "新增标签",
      created: "技能标签已创建。",
      conflict: "该技能名称已存在，请换一个。",
    },
    updated: "技能标签已更新。",
    deactivated: "技能标签已停用。",
    activated: "技能标签已启用。",
    reordered: "顺序已调整。",
    usageNote: "停用后成员不能再新选该标签，已经选过的成员仍会看到它；标签不做物理删除。",
    orderNote: "列表顺序就是成员端技能标签的展示顺序：拖动行首的手柄即可调整，键盘用每行的 ↑ ↓。",
  },
  comments: {
    label: "Comments",
    title: "评论管理",
    lead: "查看全部维修记录的内部评论，确认评论挂在哪条记录上，并删除违规内容。删除为软删除，正文保留供审计。",
    filter: {
      query: "评论正文 / 作者 / 记录 ID",
      deleted: "删除状态",
      dateFrom: "起始日期",
      dateTo: "结束日期",
      submit: "筛选",
      reset: "清除筛选",
    },
    table: {
      body: "评论内容",
      author: "作者",
      record: "所属记录",
      meta: "回复 / 提及",
      createdAt: "发表时间",
      state: "状态",
      actions: "操作",
    },
    meta: { replies: "回复 {count}", mentions: "@ {count}" },
    action: { record: "所属记录", remove: "删除" },
    /** 列表工具栏左侧的状态文字；`{state}` 换成当前删除态标签，前面的标签取 `filter.deleted`。 */
    toolbar: { status: "{label}：{state}" },
    recordWindow: {
      title: "所属维修记录",
      loading: "正在读取记录…",
      failed: "记录读取失败，可能已被软删除。",
      /** 记录详情窗口里的评论区标题，`{count}` 是根评论 + 回复的总数。 */
      comments: "评论（{count}）",
      empty: "这条记录还没有评论。",
      reply: "回复",
    },
    removePanel: {
      title: "删除评论",
      hint: "软删除不会物理删除正文：正文保留在库里供审计追溯，成员端立即不可见。",
      submit: "确认删除",
      done: "评论已删除。",
      cancel: "取消",
    },
    deletedTag: "已删除",
    /** 未删除评论的状态标签（与 `deletedTag` 成对，两个都在状态列里）。 */
    activeTag: "正常",
    /** 列表顶栏右侧的总数（`{count}` 由组件替换）。 */
    count: "共 {count} 条评论",
  },
  inviteCodes: {
    label: "Invite",
    title: "邀请码",
    lead: "创建与撤销成员邀请码，并调整有效期与使用次数。完整邀请码只在创建成功时显示一次，库里只存摘要。",
    filter: {
      query: "前缀 / 绑定 QQ / 手机号",
      status: "生效状态",
      all: "全部",
      submit: "筛选",
      reset: "清除筛选",
    },
    table: {
      prefix: "前缀",
      status: "状态",
      window: "生效区间",
      usage: "使用次数",
      binding: "绑定",
      createdAt: "创建时间",
      actions: "操作",
    },
    action: { policy: "调整策略", save: "保存", cancel: "取消", revoke: "撤销" },
    usage: "{used} / {max}",
    window: { forever: "长期有效", from: "起 {from}", until: "至 {until}" },
    create: {
      title: "创建邀请码",
      maxUses: "最大使用次数",
      maxUsesHint: "1–1000000 的正整数。用尽后状态变为「已用尽」。",
      activeFrom: "生效时间",
      expiresAt: "失效时间",
      timeHint: "留空表示立即生效 / 长期有效。",
      boundQq: "绑定 QQ 号",
      boundPhone: "绑定手机号",
      bindingHint: "选填。绑定后只有该 QQ / 手机号能使用这个邀请码。",
      optional: "选填",
      submit: "创建邀请码",
      created: "邀请码已创建。",
      plainCodeNote: "完整邀请码只显示这一次，关闭后无法再次查看，只能重新创建。",
    },
    /** 列表工具栏左侧的状态文字（与「创建」卡片的提示同一句，说明列表里只有前缀）。 */
    toolbar: { status: "完整邀请码只在创建时显示一次，列表里只有前缀。" },
    policy: {
      title: "调整使用策略",
      saved: "邀请码策略已更新。",
      maxUsesInvalid: "最大使用次数不能小于已使用次数。",
    },
    revoked: "邀请码已撤销。",
    notRevocable: "已撤销的邀请码不能再次撤销。",
    /** 列表顶栏右侧的总数。 */
    count: "共 {count} 条邀请码",
  },
  recruitment: {
    label: "Recruitment",
    title: "招募审核",
    lead: "查看与筛选报名、登记面试结果、跟进账号自动发放，并按当前筛选导出报名数据。",
    filter: {
      query: "报名编号 / 姓名 / QQ / 手机号",
      status: "报名状态",
      provisionStatus: "账号发放",
      submittedFrom: "提交起始日",
      submittedTo: "提交结束日",
      submit: "筛选",
      reset: "清除筛选",
    },
    table: {
      ticketNo: "报名编号",
      realName: "姓名",
      cycle: "招募批次",
      contacts: "联系方式",
      status: "报名状态",
      provision: "账号发放",
      submittedAt: "提交时间",
      actions: "操作",
    },
    action: { detail: "详情", export: "导出报名数据" },
    /** 列表工具栏右侧的总数文案；`{count}` 由组件填当前总数。 */
    count: "共 {count} 条报名",
    detail: {
      title: "报名详情",
      contacts: "联系方式",
      contactsNote: "查看报名明文联系方式会写入审计记录。",
      selfIntroduction: "自我介绍",
      preferredDirection: "意向方向",
      applicantRemark: "报名备注",
      submittedAt: "提交时间",
      reviews: "面试记录",
      reviewsEmpty: "还没有登记过面试结果。",
      interviewedAt: "面试时间",
      internalNote: "内部备注",
    },
    review: {
      title: "登记面试结果",
      result: "结果",
      passed: "面试通过",
      rejected: "未通过",
      interviewedAt: "面试时间",
      internalNote: "内部备注",
      optional: "选填",
      submit: "保存结果",
      saved: "面试结果已登记。",
      passedSaved: "已登记为面试通过，账号发放任务已创建。",
      notReviewable: "该报名当前不可登记面试结果。",
      secretNote: "初始密码只显示这一次，请立即交给本人；关闭后只能重置。",
    },
    provision: {
      title: "账号发放",
      status: "当前状态",
      pending: "发放任务处理中，若长时间未完成可以重试。",
      succeeded: "账号已发放，成员可以用报名时登记的 QQ / 手机号登录。",
      failed: "上次发放失败，可以安全重试（幂等，不会重复建号）。",
      retry: "重试发放",
      retried: "已重新发放。",
      retryUnavailable: "只有失败的发放任务可以重试。",
    },
    export: {
      note: `按当前筛选导出报名数据，最多 ${EXPORT_MAX_ROWS} 条。文件包含 QQ 与手机号明文，每次导出都会写入审计记录。`,
      csv: "导出 CSV",
      xlsx: "导出 Excel",
      done: "已开始下载，共 {count} 条报名记录。",
      empty: "当前筛选条件下没有报名记录，未生成文件。",
    },
  },
  audit: {
    label: "Audit",
    title: "审计记录",
    lead: "按动作、目标、操作者与时间检索重要操作留痕。审计只读：不提供修改或删除入口，摘要中的 QQ 与手机号在写入时已脱敏。",
    filter: {
      action: "动作",
      actorUserId: "操作者用户 ID",
      targetType: "目标类型",
      targetId: "目标 ID",
      requestId: "请求 ID",
      result: "结果",
      createdFrom: "起始日期",
      createdTo: "结束日期",
      submit: "筛选",
      reset: "清除筛选",
    },
    table: {
      createdAt: "时间",
      action: "动作",
      actor: "操作者",
      target: "目标",
      requestId: "请求 ID",
      result: "结果",
      actions: "操作",
    },
    action: { detail: "变更摘要" },
    detail: {
      title: "变更摘要",
      before: "变更前",
      after: "变更后",
      empty: "该动作没有记录变更摘要。",
      redactedNote: "摘要在写入时已脱敏：凭据类字段不记录，QQ 与手机号按打码写入。",
    },
    actorSystem: "系统",
    /** 列表顶栏：只读说明与总数。 */
    readonlyNote: "审计只读，不提供修改或删除入口。",
    count: "共 {count} 条审计记录",
    resultLabels: { SUCCESS: "成功", FAILURE: "失败" },
    /** 动作下拉里的「全部」项，带总条数，避免出现一个空白的「全部」。 */
    actionAll: "全部动作（{count}）",
    actionOption: "{action}（{count}）",
    targetLabels: {
      MemberProfile: "成员档案",
      User: "账号",
      RepairRecord: "维修记录",
      RepairCategory: "故障分类",
      RepairComment: "评论",
      Skill: "技能标签",
      InviteCode: "邀请码",
      JoinApplication: "报名记录",
      AccountProvision: "账号发放",
      PublicContentSetting: "公开统计设置",
    },
  },
  settings: {
    label: "Settings",
    title: "公开统计",
    lead: "决定官网首页对外展示什么。三项开关默认全部关闭；在明确打开之前，官网不会展示任何真实统计。",
    stats: {
      title: "首页维修数据",
      enabled: "展示累计维修设备数",
      enabledHint: "只统计已审核通过、未删除的记录，草稿与异常记录不计入。",
      detail: "同时展示本学期维修数与累计维修时长",
      detailHint: "需要先打开上一项；主开关关闭时本项会自动关闭。",
    },
    rankings: {
      title: "首页排行榜",
      enabled: "展示简化排行榜",
      enabledHint: "只展示名次、展示名与数量。",
    },
    display: {
      title: "排行榜展示名",
      hint: "选「真实姓名」或「仅昵称」时，排行榜上显示对应的名字；选「隐藏」时只显示名次与数量。",
      modeLabels: {
        // 比 `rankingDisplayNameLabels` 更口语：这里是设置项本身，不是表格里的取值展示。
        REAL_NAME: "真实姓名",
        NICKNAME: "仅昵称",
        HIDDEN: "隐藏姓名",
      },
    },
    submit: "保存设置",
    saved: "公开统计设置已保存。",
    updatedAt: "上次修改：{time} · {name}",
    never: "尚未修改过，当前为默认值（全部关闭）。",
    /* 「当前对外效果」原先是一串文字（「首页展示累计维修设备数。」），
       读起来仍要在脑子里拼装出页面。改成**直接画出首页那两块**：
       管理员判断的是「官网上会看到什么」，那就把官网长什么样摆出来。 */
    preview: {
      title: "首页预览",
      note: "按当前设置，官网首页会呈现成下面这样。维修数据要等 M7 接入后才有真实数值，这里用「—」占位；排行榜的名次与人数仅为示意。",
      statsOff: "首页不展示维修统计。",
      statsTotal: "累计服务",
      statsTotalUnit: "台设备",
      statsTerm: "本学期维修",
      statsTermUnit: "台",
      statsDuration: "累计维修时长",
      statsDurationUnit: "小时",
      placeholder: "—",
      rankingsOff: "首页不展示排行榜。",
      rankingsTitle: "本学期维修排行",
      rankingsHidden: "已隐藏",
      /** 示意用的名次与数量（需求 §32 的例子），不是真实数据。 */
      rankingCounts: [26, 21, 18],
      rankingNames: {
        REAL_NAME: ["张三", "李四", "王五"],
        NICKNAME: ["小张同学", "阿李", "老王"],
      },
    },
  },
} as const;
