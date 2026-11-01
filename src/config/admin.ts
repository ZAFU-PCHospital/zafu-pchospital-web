import type { NavItem } from "@/config/navigation";
import {
  EXPORT_MAX_ROWS,
  type InviteCodeEffectiveStatus,
  type JoinApplicationStatus,
  type MemberStatus,
  type ProvisionStatus,
  type RankingDisplayNameMode,
  type RoleCode,
} from "@/types/contracts";

/** 后台导航独立于公开 mainNav，避免后台入口出现在公开导航中。 */

/** 章节编号同时用于侧栏与页面标题。 */
export const ADMIN_SECTION_INDEX = {
  home: "00",
  members: "01",
  inviteCodes: "02",
  recruitment: "03",
  repairs: "04",
  repairActivities: "05",
  categories: "06",
  export: "07",
  skills: "08",
  audit: "10",
  settings: "11",
} as const;

/** 后台导航按任务分组；窄屏由底部标签栏与更多抽屉承接。 */
export type AdminNavGroup = {
  id: string;
  title: string;
  items: readonly NavItem[];
};

export const adminNavGroups: readonly AdminNavGroup[] = [
  {
    id: "todo",
    title: "待办",
    items: [
      {
        index: ADMIN_SECTION_INDEX.repairs,
        label: "维修审核",
        shortLabel: "审核",
        labelEn: "Repairs",
        href: "/admin/repairs",
        icon: "wrench",
      },
      {
        index: ADMIN_SECTION_INDEX.recruitment,
        label: "招募审核",
        shortLabel: "招募",
        labelEn: "Recruitment",
        href: "/admin/join-applications",
        icon: "clipboard",
      },
    ],
  },
  {
    id: "repairs",
    title: "维修业务",
    items: [
      {
        index: ADMIN_SECTION_INDEX.repairActivities,
        label: "维修活动",
        shortLabel: "活动",
        labelEn: "Activities",
        href: "/admin/repair-activities",
        icon: "calendar",
      },
    ],
  },
  {
    id: "members-accounts",
    title: "成员与账号",
    items: [
      {
        index: ADMIN_SECTION_INDEX.members,
        label: "成员管理",
        shortLabel: "成员",
        labelEn: "Members",
        href: "/admin/members",
        icon: "users",
      },
      {
        index: ADMIN_SECTION_INDEX.inviteCodes,
        label: "邀请码",
        shortLabel: "邀请码",
        labelEn: "Invite",
        href: "/admin/invite-codes",
        icon: "key",
      },
    ],
  },
  {
    id: "content",
    title: "内容配置",
    items: [
      {
        index: ADMIN_SECTION_INDEX.categories,
        label: "故障分类",
        shortLabel: "分类",
        labelEn: "Categories",
        href: "/admin/categories",
        icon: "folder",
      },
      {
        index: ADMIN_SECTION_INDEX.skills,
        label: "技能标签",
        shortLabel: "技能",
        labelEn: "Skills",
        href: "/admin/skills",
        icon: "tag",
      },
    ],
  },
  {
    id: "data",
    title: "数据",
    items: [
      {
        index: ADMIN_SECTION_INDEX.export,
        label: "数据导出",
        shortLabel: "导出",
        labelEn: "Export",
        href: "/admin/export",
        icon: "download",
      },
      {
        index: ADMIN_SECTION_INDEX.audit,
        label: "审计记录",
        shortLabel: "审计",
        labelEn: "Audit",
        href: "/admin/audit",
        icon: "shield",
      },
      {
        index: ADMIN_SECTION_INDEX.settings,
        label: "公开统计",
        shortLabel: "统计",
        labelEn: "Public Stats",
        href: "/admin/settings",
        icon: "sliders",
      },
    ],
  },
] as const;

/** 扁平派生：含全部 11 个模块，顺序与分组内一致，供需要遍历全部入口的地方使用。 */
export const adminNav: readonly NavItem[] = adminNavGroups.flatMap((group) => [...group.items]);

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

/** 共享措辞：所有后台页面用同一套加载/失败/空态文案，避免每个页面各写一遍。 */
export const adminShared = {
  loading: "正在加载…",
  reload: "重新加载",
  loadFailed: "加载失败，请稍后重试",
  submitting: "提交中…",
  empty: "暂无数据",
  forbidden: "当前账号没有执行该操作的权限",
  sessionExpired: "登录状态已失效，请重新登录",
  batchPartial: "部分操作未成功，请查看逐条结果",
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
    lead: "所有条件同时满足",
    field: "列",
    op: "运算符",
    value: "值",
    pick: "请选择",
    add: "添加条件",
    remove: "删除这条条件",
    empty: "暂无筛选条件",
    apply: "应用",
    reset: "清空条件",
    /** 有没填完的条件时「应用」是灰的，这句话说明为什么。 */
    incomplete: "请补全筛选条件",
    limit: "最多 {count} 条条件",
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
  /** 窄屏底部标签栏与「更多」抽屉。 */
  tabbarLabel: "管理快捷导航",
  moreLabel: "更多",
  moreMenuLabel: "全部模块",
  moreCloseLabel: "关闭",
  home: {
    label: "Admin",
    /** 构建期注入的提交版本；未注入时显示未知。 */
    versionLabel: "线上版本",
    versionUnknown: "未知",
    versionTitle: "完整提交：{sha}",
    /** 待办数字带：数字来自 `/api/v1/admin/dashboard`，加载失败显示为「—」而不是 0。 */
    todoTitle: "待办",
    todoTag: "To-do",
    todoRepairs: "待审核维修",
    todoRepairsHint: "前往维修审核",
    todoRecruitment: "待跟进报名",
    todoRecruitmentHint: "已提交 + 待面试",
    todoProvisionFailed: "发放失败",
    todoProvisionFailedHint: "前往招募审核重试",
    todoInvites: "可用邀请码",
    todoInvitesHint: "前往邀请码管理",
    todoMembers: "成员总数",
    todoMembersHint: "前往成员管理",
    todoAllClear: "今天的待办已经清零",
    todoLoadFailed: "待办数字加载失败，请稍后重试",
    retry: "重新加载",
    /** 全模块目录：与侧栏同一套分组，首页上每项带一句说明（按 href 取）。 */
    directoryTitle: "全部模块",
    directoryTag: "Modules",
    directoryDesc: {
      "/admin/repairs": "审核、退回与修正成员提交的维修记录",
      "/admin/join-applications": "跟进报名、登记面试结果与账号发放",
      "/admin/repair-activities": "创建与管理面向公众的维修活动",
      "/admin/members": "检索成员、设置角色与账号状态",
      "/admin/invite-codes": "创建与撤销成员注册邀请码",
      "/admin/categories": "维护维修记录的故障分类与排序",
      "/admin/skills": "维护成员可选择的技能标签库",
      "/admin/export": "按筛选条件导出维修记录",
      "/admin/audit": "检索重要操作的留痕（只读）",
      "/admin/settings": "决定官网首页对外展示的统计",
    } as Record<string, string>,
  },
  members: {
    department: "部门",
    label: "Members",
    title: "成员管理",

    filter: {
      query: "姓名 / 昵称 / 学号 / 班级 / QQ / 手机号",
      status: "成员状态",
      role: "角色",
      all: "全部",
      submit: "筛选",
      reset: "清除筛选",
      hint: "姓名、昵称、学号、班级、QQ 与手机号支持部分匹配",
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
      moved: "已调整该成员的顺序",
      movedMany: "已把 {count} 位成员一起移动到新位置",
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
    export: {
      note: `最多 ${EXPORT_MAX_ROWS} 条，QQ 与手机号脱敏，不含邮箱`,
      columns: {
        approvedRepairCount: "已通过维修次数",
        approvedRepairMinutes: "维修总时长（分钟）",
        qqMasked: "QQ 号（脱敏）",
        phoneMasked: "手机号（脱敏）",
        memberProfileId: "成员档案 ID",
      },
    },
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
      hint: "QQ 号 5–11 位数字；手机号 11 位中国大陆号码。初始密码为 QQ 号后 6 位（不足 6 位取全部数字）",
      created: "成员已创建，请立即把初始密码交给本人：",
      secretRule: "初始密码为成员 QQ 号后 6 位（不足 6 位取全部数字），首次登录后必须修改",
      /** 服务端没回初始密码时的兜底文案（正常路径不会出现）。 */
      secretMissing: "服务端未返回初始密码，请用「重置密码」重新生成",
    },
    edit: {
      title: "编辑成员资料",
      submit: "保存修改",
      saved: "成员资料已保存",

      disabled: "成员已禁用",
      enabled: "成员已重新启用",
      cancel: "收起",
    },
    roles: {
      title: "角色",
      submit: "保存角色",
      saved: "角色已更新",
      hint: "不允许撤销最后一个在册管理员",
    },
    skills: {
      title: "技能标签",
      submit: "保存技能标签",
      saved: "技能标签已更新",
      /** 标签选择器文案（`{count}` / `{name}` / `{limit}` 由组件替换）。 */
      empty: "还没有选择技能标签",
      remaining: "还可以添加 {count} 个",
      remove: "移除标签 {name}",
      inactive: "已停用",
      limitReached: "已达上限 {limit} 个，先移除一个再加",
    },
    detail: {
      title: "成员详情",
      contacts: "联系方式",

      stats: "维修统计",
      statsUnavailable: "维修统计暂时不可用",
    },
    /** 手动重置的二次确认：先核验本人，再签发临时密码。 */
    resetConfirm: {
      title: "重置密码",
      body: "重置前请先通过原绑定联系方式（QQ / 手机号）核验本人。确认后该账号的旧密码与全部登录会话立即失效，临时密码只显示一次",
      confirm: "确认重置",
    },
    resetResult: {
      title: "临时密码已签发，请立即交给本人：",
      /** 到期时间行（`{time}` 由组件替换为 Asia/Shanghai 时刻）。 */
      expires: "有效期至 {time}",
      note: "临时密码 1 小时内有效，仅可登录一次，登录后须立即改密；关闭后无法再次查看",
    },
    /**
     * 账号恢复：目标可以是成员或另一位管理员（含没有成员档案的管理员），
     * 所以入口常驻在工具栏、按 QQ 精确查询，不依赖成员列表里有没有这一行。
     */
    account: {
      action: "账号恢复",
      title: "账号恢复",
      lead: "输入完整 QQ 号查找账号",
      qq: "QQ 号",
      submit: "查询账号",
      verifyNote: "签发前请先通过原绑定联系方式核验本人，不要仅凭姓名或手机号确认",
      displayName: "姓名",
      roles: "角色",
      sign: "确认签发临时密码",
      signNote: "签发后该账号的旧密码与全部登录会话立即失效",
      /** `blockedReason` 对应的拒绝说明（服务端同样拒绝，这里只提前告知）。 */
      blocked: {
        SELF: "这是你自己的账号：不能自我恢复，请使用「修改密码」",
        DISABLED: "该账号已被禁用或删除，不能通过恢复重新启用",
        MEMBER_INACTIVE: "该成员身份已被撤销，恢复后也无法登录，请先在成员管理中启用",
      } as Record<string, string>,
      resultTitle: "临时密码已签发，请立即交给本人：",
      resultExpires: "有效期至 {time}",
      resultNote: "临时密码 1 小时内有效，仅可登录一次，登录后须立即改密；关闭后无法再次查看",
    },
  },
  repairs: {
    label: "Repairs",
    title: "维修审核",
    filter: {
      query: "机主姓名 / 内容 / 备注 / 成员",
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
      hint: "支持部分匹配；「全部」不含草稿",
    },
    table: {
      repairDate: "维修日期",
      member: "成员",
      ownerName: "机主姓名",
      ownerPhone: "机主电话",
      deviceModel: "机型",
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
      rejectHint: "退回必须填写原因，会同时通知提交人",
      notePlaceholder: "说明需要申请人补充或修正的内容",
      submit: "确认退回",
      cancel: "取消",
    },
    edit: {
      title: "修改异常数据",
      reason: "修改原因",
      reasonHint: "请说明修改原因",
      submit: "保存修改",
      saved: "记录已更新，审核状态未改变",
      categoryInactive: "已停用的分类不能作为新值",
    },
    removePanel: {
      title: "软删除记录",
      reason: "删除原因",
      hint: "删除后该记录不再计入统计",
      submit: "确认软删除",
      done: "记录已软删除",
      cancel: "取消",
    },
    flags: {
      title: "案例标记",
      difficult: "标记为疑难案例",
      typical: "标记为典型案例",
      submit: "保存标记",
      saved: "标记已更新",
    },
    detail: {
      title: "记录详情",
      photos: "维修照片",
      photosEmpty: "这条记录没有上传照片",
      photosLoadFailed: "照片加载失败",
    },
  },
  repairActivities: {
    label: "Activities",
    title: "维修活动",
    table: {
      title: "标题",
      activityAt: "活动时间",
      window: "报名窗口",
      capacity: "名额",
      attendance: "出勤",
      status: "状态",
      actions: "操作",
    },
    create: {
      title: "新建活动",
      titleField: "标题",
      capacity: "人数上限（至少 1 人）",
      activityAt: "活动时间",
      signupOpensAt: "报名开始",
      signupClosesAt: "报名截止",
      timeHint: "报名开始须早于截止，截止不得晚于活动开始",
      submit: "创建活动",
      created: "活动已创建",
    },
    edit: {
      title: "编辑活动",
      submit: "保存修改",
      saved: "活动已更新",
      cancel: "取消",
    },
    removePanel: {
      title: "删除活动",
      hint: "删除后活动不再公开展示，无法恢复",
      submit: "确认删除",
      done: "活动已删除",
      cancel: "取消",
    },
    action: { edit: "编辑", remove: "删除", registrations: "报名管理" },
    registrations: {
      title: "报名管理",
      count: "共 {count} 条报名",
      /** 报名列表的行序号（按当前顺序从 1 开始）。 */
      rowNumber: "序号",
      name: "姓名",
      phone: "手机号",
      issueType: "故障类型",
      /** 机型：报名时选填，没填显示破折号。 */
      deviceModel: "机型",
      status: "状态",
      createdAt: "报名时间",
      deleted: "已删除",
      /** 同名有效报名的人工核对提示，不按姓名强制唯一。 */
      sameName: "同名",
      sameNameHint: "本场还有其他同名有效报名，请人工核对",
      activeCount: "有效报名 {count} 条",
      activeEmpty: "暂无有效报名",
      deletedHistory: "删除历史（{count}）",
      edit: "编辑报名",
      save: "保存报名",
      delete: "删除报名",
      deleteHint: "删除后释放名额，无法恢复",
      empty: "暂无报名记录",
      saved: "报名已更新",
      deletedDone: "报名已删除",
      cancel: "取消",
    },
    count: "共 {count} 场活动",
    remaining: "剩余 {count}",
    registered: "已报 {count}",
    /** 行内名额主文案（R3）：已报 n / 上限 m */
    capacityLine: "已报 {registered} / 上限 {capacity}",
    /** 行内出勤文案：n 人。左侧字段名 / 列表列头已是「出勤」，值里不再重复 */
    attendanceLine: "{count} 人",
  },
  categories: {
    label: "Categories",
    title: "故障分类",
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
      nameHint: "例如「散热 / 清灰」",
      description: "说明",
      submit: "新增分类",
      created: "分类已创建",
      conflict: "该分类名称已存在，请换一个",
    },
    updated: "分类已更新",
    deactivated: "分类已停用",
    activated: "分类已启用",
    reordered: "顺序已调整",
    usageNote: "已使用的分类只能停用",
    orderNote: "拖动手柄或使用 ↑ ↓ 调整顺序",
  },
  export: {
    label: "Export",
    title: "数据导出",
    filter: {
      query: "机主姓名 / 内容 / 备注 / 成员",
      status: "审核状态",
      result: "维修结果",
      category: "故障分类",
      dateFrom: "起始日期",
      dateTo: "结束日期",
      all: "全部",
      hint: "支持部分匹配；「全部」不含草稿",
    },
    format: {
      label: "导出格式",
      csv: "CSV（Excel 可直接打开）",
      xlsx: "Excel（.xlsx）",
    },
    submit: "导出",
    note: `最多导出 ${EXPORT_MAX_ROWS} 条，超出时请缩小筛选范围`,
    done: "已开始下载，共 {count} 条记录",
    /* 导出前统计匹配条数；无结果时不生成文件，并显示当前筛选条件。 */
    preview: {
      loading: "正在统计匹配条数…",
      count: "当前筛选条件匹配 {count} 条记录",
      zero: "当前筛选条件匹配 0 条记录，导出的文件会是空的",
      failed: "匹配条数统计失败：{message}",
    },
    emptyFiltered: "没有匹配的维修记录，未生成文件。当时生效的筛选条件：{filters}",
    emptyNoFilter: "当前没有任何可导出的维修记录，未生成文件",
    columns:
      "导出列：维修日期、维修成员、机主姓名、机主电话、故障分类、维修结果、维修时长、审核状态、创建时间、记录 ID、维修照片链接",
  },
  /* ------------------------------------------------------------------ 批 2 */
  skills: {
    label: "Skills",
    title: "技能标签",
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

    create: {
      title: "新增技能标签",
      name: "名称",
      nameHint: "例如「笔记本拆装」",
      description: "说明",
      submit: "新增标签",
      created: "技能标签已创建",
      conflict: "该技能名称已存在，请换一个",
    },
    updated: "技能标签已更新",
    deactivated: "技能标签已停用",
    activated: "技能标签已启用",
    reordered: "顺序已调整",
    usageNote: "停用后不可新选，已选标签保留",
    orderNote: "拖动手柄或使用 ↑ ↓ 调整顺序",
  },
  inviteCodes: {
    label: "Invite",
    title: "邀请码",
    filter: {
      query: "前缀 / 绑定 QQ / 手机号",
      status: "生效状态",
      all: "全部",
      submit: "筛选",
      reset: "清除筛选",
      hint: "QQ 与手机号须填完整号码",
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
      maxUsesHint: "1–1000000 次",
      activeFrom: "生效时间",
      expiresAt: "失效时间",
      timeHint: "留空表示立即生效 / 长期有效",
      boundQq: "绑定 QQ 号",
      boundPhone: "绑定手机号",
      bindingHint: "绑定后仅限该账号使用",
      optional: "选填",
      submit: "创建邀请码",
      created: "邀请码已创建",
      plainCodeNote: "请保存邀请码，关闭后无法再次查看",
    },
    policy: {
      title: "调整使用策略",
      saved: "邀请码策略已更新",
      maxUsesInvalid: "最大使用次数不能小于已使用次数",
    },
    revoked: "邀请码已撤销",
    notRevocable: "已撤销的邀请码不能再次撤销",
    /** 列表顶栏右侧的总数。 */
    count: "共 {count} 条邀请码",
  },
  recruitment: {
    label: "Recruitment",
    title: "招募审核",
    filter: {
      recruitmentCycle: "招募批次",
      cyclePlaceholder: "输入完整批次，留空显示全部",
      query: "报名编号 / 姓名 / QQ / 手机号",
      status: "报名状态",
      provisionStatus: "账号发放",
      submittedFrom: "提交起始日",
      submittedTo: "提交结束日",
      submit: "筛选",
      reset: "清除筛选",
      hint: "报名编号与姓名支持部分匹配；QQ 与手机号须填完整号码",
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
    action: { detail: "详情", export: "导出报名数据", approve: "通过" },
    /** 列表行内「快速通过」：跳过详情窗口，一步完成审核 + 账号发放。 */
    quickApprove: {
      title: "通过报名",
      hint: "通过后立即创建成员账号并自动发放。初始密码为成员 QQ 号后 6 位（不足 6 位取全部数字），首次登录后必须修改",
      done: "已通过，账号已发放",
    },
    deletion: {
      action: "删除报名",
      title: "删除这条报名？",
      hint: "删除后不再显示或导出此报名，并停止后续发放与通知重试。已创建的成员账号不受影响",
      retained: "同批次的 QQ 号和手机号仍被占用；需要重新报名时请联系管理员",
      done: "报名已删除",
    },
    /** 列表工具栏右侧的总数文案；`{count}` 由组件填当前总数。 */
    count: "共 {count} 条报名",
    detail: {
      title: "报名详情",
      contacts: "联系方式",

      notificationEmail: "通知邮箱",
      editNotificationEmail: "更正",
      /** 通知在途时不允许改地址：等结果出来再更正，避免「改完还以为发到了新地址」。 */
      emailSendingNote: "通知正在发送，请等待结果后再更正",
      /** 已交发信服务 / 结果未知：记录可改，但已发通知不会改发。 */
      emailSentNote: "通知已发出，更正只更新报名记录，不会改发已发通知",
      /** 学号 / 班级：历史报名未填写时显示 adminShared.none。 */
      student: "学号与班级",
      studentId: "学号",
      className: "班级",
      selfIntroduction: "自我介绍",
      preferredDirection: "意向方向",
      applicantRemark: "报名备注",
      submittedAt: "提交时间",
      reviews: "面试记录",
      reviewsEmpty: "还没有登记过面试结果",
      interviewedAt: "面试时间",
      internalNote: "内部备注",
    },
    /** 更正通知邮箱：按通知任务状态说明保存后的效果。 */
    emailCorrection: {
      title: "更正通知邮箱",
      current: "当前通知邮箱",
      newEmail: "新通知邮箱",
      submit: "保存更正",
      back: "返回详情",
      saved: "通知邮箱已更正",

      sendingBlocked: "通知正在发送，请等待结果后再更正",
      hints: {
        NONE: "保存后仅更新报名记录；这条报名还没有安排账号通知",
        PENDING: "保存后，尚未发送的通知会改用新邮箱，无需其他操作",
        SENDING: "通知正在发送，请等待结果后再更正",
        FAILED: "保存后，请在「账号通知」中点「重试通知」；系统不会自动重发",
        ACCEPTED:
          "该通知已提交发信服务，无法撤回或改发。保存只更新报名记录；如本人未收到，请核对身份后使用临时密码恢复",
        UNCERTAIN:
          "上次发送结果未知，不能直接重发。保存只更新报名记录；请先核查，必要时使用临时密码恢复",
      },
    },
    review: {
      title: "登记面试结果",
      admittedDepartment: "录取部门",
      result: "结果",
      passed: "面试通过",
      rejected: "未通过",
      interviewedAt: "面试时间",
      internalNote: "内部备注",
      optional: "选填",
      submit: "保存结果",
      saved: "面试结果已登记",
      passedSaved: "已登记为面试通过，账号已发放",
      noteAppended: "备注已补记到面试记录",
      notReviewable: "该报名当前不可登记面试结果",
      secretNote: "初始密码为成员 QQ 号后 6 位（不足 6 位取全部数字）；成员首次登录后必须修改",
    },
    provision: {
      title: "账号发放",
      status: "当前状态",
      pending: "发放任务处理中，若长时间未完成可以重试",
      succeeded: "账号已发放，成员可以用报名时登记的 QQ / 手机号登录",
      failed: "发放失败，请重试",
      retry: "重试发放",
      retried: "已重新发放",
      retryUnavailable: "只有失败的发放任务可以重试",
    },
    export: {
      note: `最多 ${EXPORT_MAX_ROWS} 条，含完整 QQ 与手机号，请妥善保管`,
      csv: "导出 CSV",
      xlsx: "导出 Excel",
      done: "已开始下载，共 {count} 条报名记录",
      empty: "当前筛选条件下没有报名记录，未生成文件",
    },
  },
  audit: {
    label: "Audit",
    title: "审计记录",
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
      hint: "操作者、目标与请求 ID 须填完整值",
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
      empty: "该动作没有记录变更摘要",
    },
    actorSystem: "系统",
    /** 列表顶栏：只读说明与总数。 */

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
      RepairActivity: "维修活动",
      RepairActivityRegistration: "活动报名",
      InviteCode: "邀请码",
      JoinApplication: "报名记录",
      AccountProvision: "账号发放",
      PublicContentSetting: "公开统计设置",
    },
  },
  settings: {
    label: "Settings",
    title: "公开统计",
    stats: {
      title: "首页维修数据",
      enabled: "展示累计维修设备数",
      enabledHint: "仅统计已通过的记录",
      detail: "同时展示本学年维修数与累计维修时长",
      detailHint: "需先开启累计维修设备数",
    },
    rankings: {
      title: "首页排行榜",
      enabled: "展示简化排行榜",
      enabledHint: "只展示名次、展示名与数量",
    },
    display: {
      title: "排行榜展示名",
      hint: "隐藏姓名时仅显示名次与数量",
      modeLabels: {
        // 比 `rankingDisplayNameLabels` 更口语：这里是设置项本身，不是表格里的取值展示。
        REAL_NAME: "真实姓名",
        NICKNAME: "仅昵称",
        HIDDEN: "隐藏姓名",
      },
    },
    submit: "保存设置",
    saved: "公开统计设置已保存",
    updatedAt: "上次修改：{time} · {name}",
    never: "尚未修改过，当前为默认值（统计关闭，排行榜展示实名）",
    /* 首页展示预览使用示意数据。 */
    preview: {
      title: "首页预览",
      note: "以下为示意数据，保存后在首页生效",
      statsOff: "首页不展示维修统计",
      statsTotal: "累计服务",
      statsTotalUnit: "台设备",
      statsTerm: "{academicYear}维修",
      statsTermUnit: "台",
      statsDuration: "累计维修时长",
      statsDurationUnit: "小时",
      placeholder: "—",
      rankingsOff: "首页不展示排行榜",
      rankingsTitle: "{academicYear}维修排行",
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
