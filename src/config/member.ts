/**
 * M3 成员工作台与个人主页文案
 *
 * 规则：
 * - 页面与组件不得硬编码展示文案，一律从这里取；
 * - 不得编造事实：不确定的信息标注「待补充」，未接入的模块明确说明「尚未接入」；
 * - 时长底层始终是整数分钟，展示时统一用下面的格式化函数。
 */

import type { NavItem } from "@/config/navigation";

/** 成员导航按任务分组。 */
export type MemberNavGroup = {
  id: string;
  title: string;
  items: readonly NavItem[];
};

/**
 * UX R3 / N1 · 口径 M-B：公开导航占 01–05，成员整段 +1 → 06–14，
 * 延续「公开 / 成员分段」历史约定（概览 06，维修 07–10，互动 11–13，账户 14）。
 */
export const memberNav: readonly MemberNavGroup[] = [
  {
    id: "overview",
    title: "概览",
    items: [
      {
        index: "06",
        label: "工作台",
        shortLabel: "工作台",
        labelEn: "Workspace",
        href: "/member",
        icon: "home",
      },
    ],
  },
  {
    id: "repairs",
    title: "维修",
    items: [
      {
        index: "07",
        label: "维修记录",
        shortLabel: "维修",
        labelEn: "Repairs",
        href: "/member/repairs",
        icon: "fileText",
      },
      {
        index: "08",
        label: "新增维修",
        shortLabel: "新增",
        labelEn: "New Repair",
        href: "/member/repairs/new",
        icon: "plus",
      },
      {
        index: "09",
        label: "维修活动",
        shortLabel: "活动",
        labelEn: "Activities",
        href: "/member/repair-activities",
        icon: "calendar",
      },
      {
        index: "10",
        label: "案例库",
        shortLabel: "案例",
        labelEn: "Case Library",
        href: "/member/cases",
        icon: "book",
      },
    ],
  },
  {
    id: "community",
    title: "互动",
    items: [
      {
        index: "11",
        label: "消息通知",
        shortLabel: "消息",
        labelEn: "Notifications",
        href: "/member/notifications",
        icon: "bell",
      },
      {
        index: "12",
        label: "我的收藏",
        shortLabel: "收藏",
        labelEn: "Favorites",
        href: "/member/favorites",
        icon: "heart",
      },
      {
        index: "13",
        label: "排行榜",
        shortLabel: "排行",
        labelEn: "Rankings",
        href: "/member/rankings",
        icon: "trophy",
      },
    ],
  },
  {
    id: "account",
    title: "账户",
    items: [
      {
        index: "14",
        label: "个人资料",
        shortLabel: "资料",
        labelEn: "Profile",
        href: "/member/profile",
        icon: "user",
      },
    ],
  },
] as const;

/**
 * 窄屏底部标签栏（issue #334）。
 *
 * 「活动」直接进入 `/member/repair-activities`，替代原「消息」标签；
 * 消息入口保留在工作台快捷操作与桌面侧栏，底部栏不再重复。
 */
export type MemberTabItem = {
  href: string;
  label: string;
  icon: NonNullable<NavItem["icon"]>;
  exact?: boolean;
  primary?: boolean;
};

export const memberTabs: readonly MemberTabItem[] = [
  { href: "/member", label: "工作台", icon: "home", exact: true },
  { href: "/member/repairs", label: "维修", icon: "fileText" },
  { href: "/member/repairs/new", label: "新增", icon: "plus", primary: true },
  { href: "/member/repair-activities", label: "活动", icon: "calendar" },
  { href: "/member/profile", label: "我的", icon: "user" },
];

export const memberCopy = {
  /** 成员壳品牌与导航无障碍名 */
  shell: {
    title: "成员空间",
    titleEn: "Member",
    navLabel: "成员导航",
    /** 窄屏底部标签栏的无障碍名 */
    tabbarLabel: "成员快捷导航",
  },

  common: {
    /** 无昵称也无实名时的兜底展示名 */
    fallbackName: "成员",
    /** 区块聚合失败时的展示文案（**不是** "0 次"） */
    unavailable: "暂不可用",
    loading: "正在加载…",
    loadError: "加载失败，请稍后重试",
    /** 局部区块加载失败：与整页 loadError 区分，避免用户误以为整页不可用 */
    sectionLoadError: "这部分内容暂时无法加载，其余内容不受影响",
    reload: "重新加载",
    saving: "保存中…",
    save: "保存",
    cancel: "取消",
    edit: "编辑",
    /** 当前成员自己的角色标签 */
    roleLabels: {
      MEMBER: "成员",
      ADMIN: "管理员",
    } as Record<string, string>,
    internalOnly: "内部可见",
  },

  /**
   * 「已登录但没有有效成员档案」的空态（`/member`）。
   *
   * 这类账号是合法存在的：M1 的账号发放与 M6 的「新增成员」都会产生
   * 「有 ADMIN 角色、没有成员档案」的纯管理员。空态必须给出**下一步能去哪**，
   * 否则误入 `/member` 的管理员会看到一句「尚未开通成员身份」而无路可走。
   */
  noProfile: {
    title: "当前账号尚未开通成员身份，暂时无法使用成员工作台",
    note: "如果你的入团申请已通过审核，请联系管理员确认账号状态",
    adminNote: "请前往管理后台",
  },

  dashboard: {
    title: "成员工作台",
    label: "Member Workspace",
    welcome: "欢迎回来",
    joinedAtLabel: "加入时间",
    skillsLabel: "技能标签",
    skillsTag: "Skills",
    skillsEditLink: "编辑技能标签",
    noSkills: "尚未选择技能标签",
    settingsAction: "编辑个人资料",

    /** 时段问候（客户端按本地时间计算，避免服务端 / 客户端时区不一致）。 */
    greetings: {
      dawn: "夜深了",
      morning: "早上好",
      noon: "中午好",
      afternoon: "下午好",
      evening: "晚上好",
    },

    /** 待办数字带：四项全部指向可行动的列表 / 页面。 */
    actionTitle: "待办",
    actionTag: "To-do",
    actionDraft: "草稿待提交",
    actionPending: "等待审核",
    actionRejected: "退回待处理",
    actionUnread: "未读消息",
    actionAllClear: "待办都处理完了，去登记一次新的维修吧",

    metricsTitle: "维修概览",
    metricsTag: "Repair Metrics",
    metricTotal: "累计已通过",
    metricYear: "本学年已通过",
    metricMonth: "本月已通过",
    metricDuration: "累计维修时长",
    unitCount: "次",
    /** 统计口径说明：让「已通过」的口径对用户可见 */
    metricsFootnote: "仅统计审核已通过的维修记录",

    queueTitle: "待处理维修",
    queueTag: "Work Queue",
    queueDraft: "草稿",
    queuePending: "待审核",
    queueRejected: "已退回",
    queueEmpty: "当前没有待处理的维修记录",

    quickTitle: "快捷操作",
    quickTag: "Shortcuts",
    /** hero 唯一 solid 主 CTA，同时也是快捷入口的第一格 */
    quickNew: "新增维修记录",
    quickNewDesc: "登记一次维修服务",
    quickAll: "全部维修记录",
    quickAllDesc: "查看、筛选我的记录",
    quickActivities: "维修活动",
    quickActivitiesDesc: "报名与接待活动",
    quickNotifications: "消息通知",
    quickNotificationsDesc: "维修审核动态",
    quickFavorites: "我的收藏",
    quickFavoritesDesc: "收藏的案例记录",
    quickRankings: "排行榜",
    quickRankingsDesc: "本学年维修榜",
    /** 案例库没有进窄屏底部标签栏，工作台快捷入口是它在手机上的主要入口。 */
    quickCases: "案例库",
    quickCasesDesc: "典型案例与疑难案例",
    quickProfile: "编辑个人资料",
    quickProfileDesc: "昵称与技能标签",

    recentTitle: "最近已通过维修",
    recentTag: "Recent Approved",
    recentEmpty: "暂时还没有已通过的维修记录",
    recentMore: "查看全部记录",

    /** 工作台底部：M4 通知/收藏与 M5 排行均为真实数据 */
    upcomingTitle: "交流与后续",
    upcomingTag: "Community",
    upcomingNotifications: "消息通知",
    upcomingFavorites: "收藏",

    rankingTitle: "维修排行",
    rankingTag: "Rankings",
    rankingTopLabel: "本学年前 {count} 名",
    rankingEmpty: "本学年暂无上榜记录",
    rankingMyRank: "我的排名",
    /** 我的名次展示模板，`{rank}` 会被替换成名次数值 */
    rankingMyRankValue: "第 {rank} 名",
    rankingNoRank: "当前范围暂无上榜记录",
    rankingFootnote: "仅统计审核已通过的维修记录，按维修数量排名",
  },

  profile: {
    title: "个人资料",
    label: "Member Profile",
    identityTitle: "成员身份",
    identityTag: "Identity",
    skillsTitle: "技能标签",
    skillsTag: "Skills",
    skillsLead: "最多选择 {limit} 项",
    skillsEmpty: "尚未选择任何技能标签",
    skillsUnavailable: "技能列表加载失败",
    skillsLimitReached: "最多只能选择 {limit} 项技能",
    skillInactiveSelected: "已停用",
    /** 标签选择器的剩余额度与单标签移除按钮文案（空态复用上面的 `skillsEmpty`）。 */
    skillsRemaining: "还可以添加 {count} 个",
    skillsRemove: "移除标签 {name}",

    /** 标签库里没有想要的标签时，成员可以自己新建（无需审核）。 */
    skillCreateLabel: "新建标签",
    skillCreatePlaceholder: "输入名称，如：拆机清灰",
    skillCreateHint: "标签库没有的可以直接新建，它会进入公共标签库，其他成员也能选用",
    skillCreateAction: "新建",
    skillCreateBusy: "新建中…",
    skillCreated: "已新增「{name}」，点「保存」后关联到你的资料",
    skillCreateFailed: "标签新建失败，请稍后重试",
    metricsTitle: "维修概览",
    metricsTag: "Repair Metrics",
    recentTitle: "最近已通过维修",
    recentTag: "Recent Approved",

    /** M5：分类分布与月度趋势。图表必须带可读的文字/表格替代，不能只靠图形 */
    distributionTitle: "故障分类分布",
    distributionTag: "Categories",
    distributionEmpty: "暂无已通过的维修记录，因此没有分类分布",
    distributionTableCaption: "按故障分类统计的已通过维修数量与时长",
    distributionUnitCount: "次",
    distributionUnitDuration: "时长",
    /** 统计表格的列头 */
    columnCategory: "分类",
    columnCount: "数量",
    columnDuration: "时长",
    columnMonth: "月份",
    columnTotal: "合计",
    trendTitle: "最近 12 个月维修趋势",
    trendTag: "Trend",
    trendEmpty: "最近 12 个月暂无已通过的维修记录",
    trendTableCaption: "最近 12 个月按月的已通过维修数量与时长",
    trendMonth: "月份",
    trendUnavailable: "统计加载失败",
    trendTotalLabel: "合计",

    /** 只读字段：明确标注不可自助修改，且不渲染成输入框 */
    readonlyNote: "以下信息由管理员维护，暂不支持自助修改",
    fieldRealName: "实名",
    fieldStudentId: "学号",
    fieldClassName: "班级",
    fieldQq: "QQ",
    fieldJoinedAt: "加入时间",
    fieldRoles: "角色",
    fieldStatus: "成员状态",
    notProvided: "未填写",

    nicknameLabel: "昵称",
    nicknameHint: "留空则展示实名。最多 {max} 个字符，不支持换行与控制字符",
    nicknamePlaceholder: "例如：小林",

    /** 乐观锁冲突与校验错误 */
    conflict: "资料已在其他位置被修改，请刷新后重试",
    saveFailed: "保存失败，请稍后重试",
    invalidNickname: "昵称格式不正确",
    saved: "已保存",
    skillsSaved: "技能标签已更新",
  },

  internal: {
    title: "成员主页",
    label: "Member Profile",
    identityTitle: "成员身份",
    identityTag: "Identity",
    skillsTitle: "技能标签",
    skillsTag: "Skills",
    noSkills: "该成员尚未选择技能标签",
    metricsTitle: "维修概览",
    metricsTag: "Repair Metrics",
    recentTitle: "最近已通过维修",
    recentTag: "Recent Approved",
    recentEmpty: "该成员暂时还没有已通过的维修记录",
    selfAction: "这是你自己的主页，前往个人资料编辑",
    /** 明确说明他人视图的可见性边界 */
    visibilityNote: "仅展示已通过的维修记录；草稿、待审核与已退回记录不可见",
  },
} as const;

/** 通知列表标记已读 / 全部已读 / 删除成功后派发；成员端页面据此刷新自身状态 */
export const MEMBER_NOTIFICATIONS_CHANGED_EVENT = "member:notifications-changed";

/** 把整数分钟格式化为「x 小时 y 分钟」。底层仍存整数分钟，这里只做展示。 */
export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

/**
 * 把「次」类指标格式化为带单位的字符串；`null` 显示为传入的占位文案。
 *
 * 注意：返回的字符串**已经带「次」**，只能用在纯文本位置（表格单元格、列表）。
 * 指标卡（`MemberMetrics`）要的是「大号数字 + 小号单位 span」，用它会变成「1 次次」——
 * 那正是 M3 起界面上一直显示重复单位的根因，别在这里加单位再叠一个 span。
 */
export function formatCount(value: number | null, unavailableLabel: string): string {
  if (value === null) return unavailableLabel;
  return `${value} 次`;
}

/** 把 ISO 时间戳格式化为 `YYYY-MM-DD`（Asia/Shanghai），失败时返回占位。 */
export function formatShanghaiDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
