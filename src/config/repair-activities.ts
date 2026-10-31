import type { RepairActivityStatus } from "@/features/repair-activities/repair-activity-validation";

/**
 * 免责声明版本。
 *
 * 改动 `detail.consent.clauses` 之后**必须**同时改这个值：报名记录里存的是当时那一版，
 * 用于日后核对「这位同学同意的是哪一版文本」。格式为日期，便于排序与人工核对。
 */
export const repairActivityConsentVersion = "2026-10-25";

/**
 * 公开维修活动页文案（M1）。
 */
export const repairActivitiesPage = {
  title: "维修活动",
  label: "Activities",
  lead: "电脑医院不定期举办现场维修活动。选择一场活动报名，到场后由成员接待",
  empty: "暂时没有可展示的维修活动",
  loadFailed: "活动列表加载失败，请稍后重试",
  loadingPage: "正在加载第 {page} 页…",
  pageLoadFailed: "第 {page} 页加载失败，请稍后重试",
  remaining: "剩余名额 {count}",
  /** 公开列表卡片用更短的「剩余 N」。 */
  remainingShort: "剩余 {count}",
  capacity: "名额 {registered} / {capacity}",
  activityAt: "活动时间",
  window: "报名时间",
  endedHint: "活动已结束",
  previousPage: "上一页",
  nextPage: "下一页",
  paginationLabel: "分页",
  /** 列表页辅助区：标题与条目复用 detail 的到场准备文案，不重复维护。 */
  preparationSection: { index: "03", label: "Preparation" },
  detail: {
    backToList: "维修活动",
    breadcrumb: "活动详情",
    queue: {
      title: "现场排队情况",
      refresh: "刷新",
      waiting: "人等待接待",
      definition: "仅统计已签到、尚未接待的客户",
      guidance: "人数仅供参考，请按活动通知时间到场",
      loading: "正在获取等候人数…",
      unavailable: "人数暂不可用，请稍后刷新",
      stale: "更新失败，人数可能已变化",
      updated: "{time} 更新 · 每 30 秒自动刷新",
      lastUpdated: "上次成功更新：{time}",
      notOpen: "签到尚未开放",
      notOpenHint: "现场开放签到后可查看等候人数",
      ended: "本场活动已结束",
      missing: "活动已不可用",
    },
    category: "校园志愿服务",
    signupTitle: "报名参加",
    lookupTitle: "已经报名？",
    lookupHint: "使用报名时的姓名与手机号查询或修改故障类型",
    lookupPhonePlaceholder: "报名时使用的手机号",
    lookupNamePlaceholder: "报名时填写的姓名",
    lookupNotFound: "未找到报名记录，请核对姓名与电话，或联系管理员",
    /** 查不到时别再重新报名：引导走查询 / 联系管理员。 */
    contactAdminHint: "信息填错了？请联系 QQ 群管理员更正，不要重新报名",
    name: "姓名",
    namePlaceholder: "用于现场核对",
    phone: "手机号",
    phonePlaceholder: "用于查询报名",
    issueType: "故障类型",
    /** 机型选填：填了成员到场前能先了解设备。 */
    deviceModel: "机型（选填）",
    deviceModelPlaceholder: "如：联想小新 Pro 14",
    submitSignup: "提交报名",
    submitLookup: "查询报名",
    submitUpdate: "保存故障类型",
    signupSuccess: "请按时到场，可使用报名手机号查询记录。到场前请做好以下准备",
    /** 报名成功后的常驻提示：弹层关闭后仍能看到。 */
    registeredHint: "如需修改故障类型，可使用下方「已经报名？」查询",
    /** 本设备已提交过本场报名（issue #304）：服务端按签名 cookie 拦截重复填写。 */
    deviceRegisteredTitle: "本设备已提交过本场报名",
    deviceRegisteredHint:
      "如需修改故障类型，请用下方「已经报名？」查询；姓名或电话填错请联系 QQ 群管理员，不要重复报名。",
    /** 设备状态结论出来前不渲染表单，避免慢网下「先填后收起」。 */
    deviceStatusChecking: "正在确认本设备是否已报名…",
    deviceRecheck: "重新检查报名状态",
    deviceRecheckHint: "管理员删除报名后，可点「重新检查报名状态」恢复填写，无需刷新整页。",
    deviceRecheckCleared: "未查到本设备的报名，可以重新填写",
    deviceRecheckFailed: "状态检查失败，请稍后重试或刷新页面",
    /** 409 后设备状态也读不到时的兜底提示：不能说成「该手机号已报名」。 */
    deviceConflictFallback: "本设备已提交过本场报名，请稍后刷新页面或联系管理员",
    /** 回执与已提交面板都带故障类型（issue #304 讨论口径）。 */
    receiptIssueType: "故障类型：{type}",
    /** 同一手机号已报名时不再显示为失败，而是引导查询已有记录。 */
    duplicateHint: "该手机号已报名本场活动，可使用下方「已经报名？」查询或修改故障类型",
    lookupMine: "查询本人记录",
    lookupRegisteredTitle: "你已报名成功",
    lookupStatusLabel: "当前状态：{status}",
    registrationNumber: "报名编号 {id}",
    receiptStatus: "报名状态：{status}",
    confirmActivity: "活动",
    confirmIdentityHint: "请确认活动、姓名与手机号无误；报名成功后可凭借手机号查询",
    confirmEdit: "返回修改",
    phoneFormatHint: "请输入 11 位中国大陆手机号",
    nameFormatHint: "请输入报名时填写的姓名（2–40 个字符）",
    signupPendingTitle: "报名结果待确认",
    signupPendingHint: "网络中断或响应异常，暂无法确认报名结果。请先查询本人记录，不要重复提交",
    checkResult: "查询报名结果",
    /** 查询确认未报名后的出口：解除待确认，允许重新填写。 */
    pendingRestart: "重新填写",
    pendingRestartHint: "确认未报名后可重新填写，重复提交会被服务端拦截",
    lookupNotFoundRetry: "暂未查到报名记录，请核对姓名与电话后再查询",
    lookupFailedRetry: "查询失败，请稍后再次查询，不要重复提交",
    lookupConfirmed: "已确认报名成功",
    precautionsTitle: "到场前，记好这四件事",
    signupSuccessTitle: "报名成功",
    acknowledgePrecautions: "我已知晓",
    signupConsentHint: "提交前会展示完整须知，征得同意后才会报名",
    fullPrecautions: "完整报名须知与免责声明 · {count} 条",
    serviceTitle: "服务说明",
    serviceHint: "社团提供免费志愿服务。能否修复、维修时长以现场检查为准；特殊拆机需求请提前咨询",
    cancelHint: "如需取消报名，请联系 QQ 群管理员",
    preparation: [
      { icon: "hardDrive", title: "备份数据", description: "送修前自行备份重要文件" },
      { icon: "plug", title: "携带电源", description: "请带上设备的电源适配器" },
      { icon: "package", title: "自备耗材", description: "清灰、换硅脂请自备导热膏等耗材" },
      {
        icon: "message",
        title: "特殊机型先咨询",
        description: "部分 Dell 游戏本请先联系 QQ 群管理员",
      },
    ],
    lookupSuccess: "已找到报名记录，可修改故障类型",
    updateSuccess: "故障类型已更新",
    signupDisabled: "当前不可报名",
    upcomingDisabled: "报名尚未开始",
    /** 报名开始倒计时：以服务器时间为准，归零后自动刷新状态。 */
    countdownPrefix: "距报名开始",
    countdownOpeningSoon: "即将开放，请稍候",
    countdownUnits: { days: "天", hours: "时", minutes: "分", seconds: "秒" },
    /** 块下只提示开始时间：截止时间由上方「报名时间」承载，避免整行重复。 */
    countdownOpensHint: "{open} 开始报名",
    /** 倒计时归零、状态转为可报名时对读屏的一次性播报。 */
    countdownOpened: "报名已开放，现在可以提交报名",
    closedDisabled: "报名已截止",
    fullDisabled: "新报名名额已满",
    fullLookupHint: "已报名者请使用下方「已经报名？」查询本人记录",
    notEditable: "当前状态不可修改故障类型（可能已签到或已接待）",
    /** 报名前的免责声明：必须点「我已阅读并同意」才能提交，服务端同样强制。 */
    consent: {
      title: "报名须知与免责声明",
      subtitle: "提交报名前请阅读以下内容；不同意则无法提交",
      clauses: [
        "报名需填写真实姓名与常用手机号：姓名用于现场核对，手机号用于查询报名与接收活动变更通知。",
        "本活动由社团成员提供免费志愿服务，不收取费用；设备能否修复、需要多长时间，以现场检查结果为准。",
        "送修前请自行备份重要数据。因设备自身老化、数据未备份等非服务方原因造成的损失，社团不承担责任。",
        "配件与耗材按现场情况与客户协商解决，社团不承诺提供配件。",
        "如需清灰、更换硅脂等使用耗材的服务，请自备硅脂（导热膏）等耗材；未自备将无法完成该类服务。",
        "送修时请携带电源适配器；部分故障需通电才能现场检查。",
        "部分 Dell 游戏本机型因主板倒装设计，换硅脂需要拆卸整块主板，对比其他机型所需时间较长，难度稍大，风险较高，由于不同场次活动的参加成员不同，我们可能不进行接待，请先 QQ 群内联系管理员确认。",
        "如果想要取消报名请联系 QQ 群内管理员，把名额留给需要的人。",
        "报名信息只用于本场活动的组织与到场核对，不对外公开。",
      ],
      agree: "我已阅读并同意",
    },
  },
  issueTypes: [
    { value: "CLEAN_PASTE", label: "清灰换硅脂" },
    { value: "CLEAN_ONLY", label: "清灰" },
    { value: "SOFTWARE_SYSTEM", label: "软件 / 系统问题" },
    { value: "OTHER", label: "其他故障" },
  ],
} as const;

/**
 * 成员端活动状态文案（issue #239）：`CLOSED` 是报名截止后的可出勤窗口，
 * 不能沿用公开页的「报名截止」；公开列表 / 详情与后台仍用公开五态文案。
 */
export const memberRepairActivityStatusLabels: Record<RepairActivityStatus, string> = {
  UPCOMING: "未开始",
  OPEN: "报名中",
  FULL: "已报满",
  CLOSED: "可出勤",
  ENDED: "已结束",
};

/**
 * 成员端维修活动文案（M2）。页面与组件不得硬编码长文案。
 */
export const memberRepairActivitiesCopy = {
  list: {
    title: "维修活动",
    label: "Activities",
    lead: "选择一场活动标记出勤，再为到场客户签到、排队与接待",
    empty: "暂时没有可接待的维修活动",
    loadFailed: "活动列表加载失败，请稍后重试",
    openBoard: "进入工作台",
    attended: "已出勤",
    notAttended: "未出勤",
    capacity: "名额 {registered} / {capacity}",
    activityAt: "活动时间",
  },
  board: {
    title: "活动工作台",
    label: "活动工作台 · STAFF BOARD",
    back: "返回活动列表",
    loadFailed: "工作台加载失败，请稍后重试",
    attendCta: "参加本场",
    attending: "标记出勤中…",
    attendSuccess: "已标记本场出勤",
    attendRequired: "请先参加本场",
    attendPrompt: "请先参加本场，再为客户签到",
    /** 成员视角（成员无「待签到」区）：出勤后可接待排队中的客户。 */
    attendPromptMember: "请先参加本场，再接待客户",
    signupNotClosed: "报名尚未截止，暂不可出勤、签到或接待",
    activityEnded: "活动已结束",
    attendedBadge: "你已出勤",
    /** 手机端分区切换行（<1100px 常显；宽屏隐藏）的无障碍名称。 */
    paneSwitcherLabel: "工作台分区切换",
    eligibleTitle: "待签到",
    eligibleTag: "Eligible",
    eligibleEmpty: "当前没有可签到的报名",
    queueTitle: "排队中",
    queueTag: "Queue",
    queueEmpty: "暂无排队客户",
    /** 成员视角（成员无「待签到」区）。 */
    queueEmptyMember: "暂无排队客户",
    /** 队列位次：按当前渲染顺序（服务端已按签到时间升序）从 1 开始。 */
    queueRank: "第{index}位",
    checkIn: "签到入队",
    checkingIn: "签到中…",
    checkInSuccess: "已签到入队",
    checkInUpdatedSuccess: "故障类型已更新，客户已签到入队",
    checkInRefreshFailed: "客户已签到入队，但工作台刷新失败，将自动重试",
    refreshFailed: "工作台刷新失败，仍显示上次数据，将自动重试",
    refresh: "立即刷新",
    retry: "重试",
    syncing: "正在同步…",
    syncReady: "已同步",
    syncNever: "尚未同步",
    syncInitialFailure: "尚未取得数据，请重试。",
    syncFailure: "同步失败，仍显示上次数据。",
    syncRepeatedFailure: "连续同步失败，数据可能未更新。",
    syncStopped: "暂时无法访问，请重试或重新登录。",
    queueSyncedAt: "队列最后同步",
    servedSyncedAt: "已接待最后同步",
    attendanceSyncedAt: "出勤名单最后同步",
    servedLoading: "正在读取已接待记录…",
    servedLoadFailed: "已接待记录读取失败，请重试。",
    attendanceLoading: "正在读取出勤名单…",
    attendanceLoadFailed: "出勤名单读取失败，请重试。",
    checkInConfirmTitle: "确认签到入队？",
    checkInConfirmHint: "请核对客户信息与故障类型",
    checkInConfirm: "确认签到",
    checkInCancel: "取消",
    selectHint: "勾选左侧报名后点「签到入队」",
    selectNone: "请先勾选至少一条报名",
    serve: "接待",
    serving: "落单中…",
    serveSuccess: "已接待，请继续填写维修记录",
    withdraw: "撤回",
    withdrawing: "撤回中…",
    withdrawSuccess: "已撤回排队",
    withdrawConfirmTitle: "确认撤回排队？",
    withdrawConfirmHint: "撤回后客户回到待签到列表",
    withdrawConfirm: "确认撤回",
    withdrawCancel: "取消",
    loading: "正在加载工作台…",
    issueType: "故障类型",
    deviceModel: "机型",
    phone: "电话",
    showPhone: "查看完整客户电话",
    hidePhone: "隐藏客户电话",
    phoneLoading: "正在读取客户电话",
    phoneLoadFailed: "客户电话读取失败，请稍后重试",
    name: "姓名",
    checkedInAt: "入队时间",
    viewRepair: "查看维修单",
    /** 「已接待」区块：常驻区块，数据空了只换内容不卸载。 */
    servedTitle: "已接待",
    servedTag: "Served",
    servedEmpty: "本场还没有已接待的客户",
    /** 成员视角：列表只含本人接待，空态要说清「你」。 */
    servedEmptySelf: "本场你还没有接待记录",
    /** 待补建：登记已接待，但维修单还没创建。 */
    servedPendingTag: "待补建",
    servedPendingHint: "客户已接待，维修单还没创建",
    continueFill: "继续填写",
    /** 非接待者（如活动管理员）看到的占位：补建记录只由接待人本人完成。 */
    servedPendingByOwner: "由接待人继续填写",
    fillRepair: "填写维修记录",
    /** 撤销接待：仅未建单的接待，接待者本人 / 活动管理员可撤。 */
    revertServe: "撤销接待",
    revertingServe: "撤销中…",
    revertServeConfirmTitle: "确认撤销接待？",
    revertServeConfirmHint: "撤销后客户回到接待前的位置",
    /** 存量接待草稿撤销时会删除未提交草稿及照片。 */
    revertServeConfirmHintLegacy: "撤销后客户回到接待前的位置，未提交的维修草稿及照片将被删除",
    revertServeConfirm: "确认撤销",
    revertServeCancel: "取消",
    revertServeSuccess: "已撤销接待，客户回到接待前的位置",
    pendingServeUndoHint: "若接错了客户，可先关掉本窗，在「已接待」区块点「撤销接待」",
    recordMissing: "维修单状态未知，请刷新后再看",
    /** 「出勤成员」入口与弹层：仅活动管理员可见的只读名单。 */
    attendanceEntry: "出勤成员 {count} 人",
    attendanceTitle: "出勤成员",
    attendanceEmpty: "本场还没有成员出勤",
    attendanceCheckedInAt: "{time} 签到",
    attendanceNote: "按签到时间升序",
    /**
     * 全局接单拦截（按登记行判定）：存在已接待但未建单的
     * 客户时不能接单，客户端先行拦截（不发请求），服务端以 `ACTIVITY_SERVE_PENDING` 兜底。
     */
    pendingServeTitle: "有未完成的接待记录",
    pendingServeBody:
      "机主「{owner}」（{activity}）已接待，但维修单还没有创建。请先完成这条记录，再接待下一位客户",
    pendingServeFill: "继续填写",
    pendingServeDismiss: "知道了",
  },
} as const;
