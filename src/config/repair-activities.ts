/**
 * 免责声明版本（issue #62 前端3）。
 *
 * 改动 `detail.consent.clauses` 之后**必须**同时改这个值：报名记录里存的是当时那一版，
 * 用于日后核对「这位同学同意的是哪一版文本」。格式为日期，便于排序与人工核对。
 */
export const repairActivityConsentVersion = "2026-10-10";

/**
 * 公开维修活动页文案（M1）。
 */
export const repairActivitiesPage = {
  title: "维修活动",
  label: "Activities",
  lead: "电脑医院不定期举办现场维修活动。选择一场活动报名，到场后由成员接待。",
  empty: "暂时没有可展示的维修活动。",
  loadFailed: "活动列表加载失败，请稍后重试。",
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
  detail: {
    signupTitle: "报名参加",
    lookupTitle: "查询 / 修改故障类型",
    name: "姓名",
    phone: "手机号",
    issueType: "故障类型",
    /** 机型选填（issue #68）：填了成员到场前能先了解设备。 */
    deviceModel: "机型（选填）",
    deviceModelPlaceholder: "如：联想小新 Pro 14",
    submitSignup: "提交报名",
    submitLookup: "查询报名",
    submitUpdate: "保存故障类型",
    signupSuccess: "报名成功。请按时到场，并保管好手机号以便查询。",
    lookupSuccess: "已找到报名记录，可修改故障类型。",
    updateSuccess: "故障类型已更新。",
    signupDisabled: "当前不可报名",
    upcomingDisabled: "报名尚未开始",
    closedDisabled: "报名已截止",
    fullDisabled: "名额已满",
    notEditable: "当前状态不可修改故障类型（可能已签到或已接待）。",
    /** 报名前的免责声明：必须点「我已阅读并同意」才能提交，服务端同样强制。 */
    consent: {
      title: "报名须知与免责声明",
      subtitle: "提交报名前请阅读以下内容；不同意则无法提交。",
      clauses: [
        "报名需填写真实姓名与常用手机号：姓名用于现场核对，手机号用于查询报名与接收活动变更通知。",
        "本活动由社团成员提供免费志愿服务，不收取费用；设备能否修复、需要多长时间，以现场检查结果为准。",
        "送修前请自行备份重要数据。因设备自身老化、数据未备份等非服务方原因造成的损失，社团不承担责任。",
        "配件与耗材按现场情况与客户协商解决，社团不承诺提供配件。",
        "如需清灰、更换硅脂等使用耗材的服务，请自备硅脂（导热膏）等耗材；未自备将无法完成该类服务。",
        "送修时请携带电源适配器；部分故障需通电才能现场检查。",
        "报名信息只用于本场活动的组织与到场核对，不对外公开。",
      ],
      agree: "我已阅读并同意",
      cancel: "取消",
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
 * 成员端维修活动文案（M2）。页面与组件不得硬编码长文案。
 */
export const memberRepairActivitiesCopy = {
  list: {
    title: "维修活动",
    label: "Activities",
    lead: "选择一场活动标记出勤，再为到场客户签到、排队与接待落单。",
    empty: "暂时没有可接待的维修活动。",
    loadFailed: "活动列表加载失败，请稍后重试。",
    openBoard: "进入工作台",
    attended: "已出勤",
    notAttended: "未出勤",
    capacity: "名额 {registered} / {capacity}",
    activityAt: "活动时间",
  },
  board: {
    title: "活动工作台",
    label: "Staff Board",
    back: "返回活动列表",
    loadFailed: "工作台加载失败，请稍后重试。",
    attendCta: "参加本场",
    attending: "标记出勤中…",
    attendSuccess: "已标记本场出勤。",
    attendRequired: "请先点击「参加本场」标记出勤，才能签到客户或接待。",
    attendPrompt: "你尚未参加本场。先标记出勤后，才能在左侧勾选报名并签到。",
    signupNotClosed: "报名尚未截止，暂不可出勤、签到或接待。",
    attendedBadge: "你已出勤",
    eligibleTitle: "待签到",
    eligibleTag: "Eligible",
    eligibleEmpty: "当前没有可签到的报名。",
    queueTitle: "排队中",
    queueTag: "Queue",
    queueEmpty: "排队为空。请到左侧勾选报名并点「签到入队」。",
    /** 队列位次：按当前渲染顺序（服务端已按签到时间升序）从 1 开始。 */
    queueRank: "第{index}位",
    checkIn: "签到入队",
    checkingIn: "签到中…",
    checkInSuccess: "已签到入队。",
    checkInUpdatedSuccess: "故障类型已更新，客户已签到入队。",
    checkInRefreshFailed: "客户已签到入队，但工作台刷新失败，将自动重试。",
    refreshFailed: "工作台刷新失败，仍显示上次数据，将自动重试。",
    checkInStaffReminder: "普通成员无需进行客户签到，签到工作请交给现场管理员。",
    checkInConfirmTitle: "确认签到入队？",
    checkInConfirmHint:
      "请逐一核对以下客户的信息与故障类型；如有误，可在此修改。确认后将为这些客户签到入队。",
    checkInConfirm: "确认签到",
    checkInCancel: "取消",
    selectHint: "勾选左侧报名后点「签到入队」。",
    selectNone: "请先勾选至少一条报名。",
    serve: "接待落单",
    serving: "落单中…",
    serveSuccess: "接待完成，请填写维修记录。",
    withdraw: "撤回",
    withdrawing: "撤回中…",
    withdrawSuccess: "已撤回排队。",
    withdrawConfirmTitle: "确认撤回排队？",
    withdrawConfirmHint: "撤回后该客户会离开排队，回到待签到列表；如需再次排队，须重新勾选并签到。",
    withdrawConfirm: "确认撤回",
    withdrawCancel: "取消",
    loading: "正在加载工作台…",
    issueType: "故障类型",
    deviceModel: "机型",
    phone: "电话",
    name: "姓名",
    checkedInAt: "入队时间",
    viewRepair: "查看维修单",
    /** 「已接待」区块（issue #79 第 6 项）：常驻区块，数据空了只换内容不卸载。 */
    servedTitle: "已接待",
    servedTag: "Served",
    servedEmpty: "本场还没有已接待的客户。",
    fillRepair: "填写维修记录",
    recordMissing: "维修单状态未知，请刷新后再看。",
    /**
     * 全局接单拦截（issue #79 第 6 项）：存在未提交的接待草稿时不能接单，
     * 客户端先行拦截（不发请求），服务端以 `ACTIVITY_SERVE_DRAFT_PENDING` 兜底。
     */
    pendingServeTitle: "有未完成的接待记录",
    pendingServeBody:
      "机主「{owner}」（{activity}）的维修记录还没有填写提交。请先完成这条记录，再接待下一位客户。",
    pendingServeFill: "去填写",
    pendingServeDismiss: "知道了",
  },
} as const;
