import { RepairResult, RepairStatus } from "@/types/contracts";

export const repairCopy = {
  list: {
    title: "维修记录",
    label: "Repair Records",
    total: "当前结果",
    newAction: "新建记录",
    quickFilters: {
      all: "全部",
      pending: "待审核",
      draft: "草稿",
      rejected: "已退回",
    },
    filters: {
      searchLabel: "搜索维修记录",
      searchPlaceholder: "搜索机主姓名、备注或成员",
      status: "状态",
      category: "分类",
      member: "维修成员",
      result: "维修结果",
      dateFrom: "起始日期",
      dateTo: "结束日期",
      allStatuses: "全部状态",
      allCategories: "全部分类",
      allMembers: "全部成员",
      allResults: "全部结果",
      more: "更多筛选",
      less: "收起筛选",
      difficult: "仅看疑难案例",
      typical: "仅看典型案例",
      submit: "搜索",
      reset: "清除",
    },
    columns: {
      date: "日期",
      category: "分类",
      deviceModel: "机型",
      content: "备注",
      member: "维修成员",
      result: "结果",
      status: "状态",
      action: "操作",
    },
    loading: "正在加载维修记录…",
    loadError: "维修记录加载失败，请稍后重试",
    reload: "重新加载",
    uncategorized: "未分类",
    missingContent: "尚未填写备注",
    missingDate: "日期待填",
    missingDeviceModel: "—",
    missingResult: "结果待填",
    difficult: "疑难",
    typical: "典型",
    view: "查看",
    previousPage: "上一页",
    nextPage: "下一页",
  },
  create: {
    title: "新建维修记录",
    label: "New Repair",
    /** 活动接待「继续填写」：预填来自登记行，提交时才建维修单。 */
    serveTitle: "继续填写维修记录",
  },
  edit: {
    title: "编辑维修记录",
    label: "Edit Repair",
    lead: "保存草稿不会进入统计；提交后等待管理员审核",
  },
  detail: {
    title: "维修记录详情",
    label: "Repair Detail",
    /** 审核前补照片：仅记录本人、提交后未审核时可见。 */
    pendingPhotoHint: "审核前可补充照片（最多 {count} 张，单张不超过 {size}）；审核通过后不可修改",
    pendingPhotoEmpty: "暂无照片，可在审核前补充",
    photoEmpty: "暂无照片",
  },
  empty: "暂时没有符合条件的维修记录",
} as const;
/**
 * 维修照片的浏览文案。
 *
 * `alt` 与 `open` 是模板而不是完整句子：详情页与审核弹窗共用同一套读屏口径，
 * 改口径只改这里，不在两个组件里各写一份。
 */
export const repairPhotoCopy = {
  alt: "维修照片 {index}，共 {count} 张",
  open: "查看维修照片 {index}，共 {count} 张",
  title: "照片预览",
  counter: "第 {index} / {count} 张",
  unavailable: "照片暂时无法读取",
  loading: "正在加载照片…",
  loadFailed: "照片加载失败，可能无权查看或文件已被清理",
  retry: "重新加载",
  close: "关闭照片预览",
  previous: "上一张照片",
  next: "下一张照片",
  zoomIn: "放大至原始尺寸",
  zoomOut: "适应窗口",
} as const;
export const repairStatusLabels: Record<(typeof RepairStatus)[number], string> = {
  DRAFT: "草稿",
  PENDING: "待审核",
  APPROVED: "已通过",
  REJECTED: "已退回",
};
export const repairResultLabels: Record<(typeof RepairResult)[number], string> = {
  COMPLETED: "已完成",
  NOT_COMPLETED: "未完成",
};
/**
 * 维修记录字段的硬限制。
 *
 * 服务端校验与表单 HTML 属性共用这一组数值 —— 两边各写一份是「限制看着有、实际没生效」
 * 的常见来源。
 */
export const repairFieldLimits = {
  contentMaxLength: 10000,
  remarkMaxLength: 2000,
  /** 机主姓名上限，与 `owner_name` 的 VarChar(40) 对齐。 */
  ownerNameMaxLength: 40,
  /** 机型上限，与 `device_model` 的 VarChar(60) 对齐。 */
  deviceModelMaxLength: 60,
  durationMinutesMin: 1,
  durationMinutesMax: 10080,
  /** 维修日期下限：早于它的基本是年份打错（1026 年、202 年这类）。 */
  repairDateMin: "2020-01-01",
  /** 参与维修人员总数上限（含创建人本人）。 */
  participantMaxCount: 9,
} as const;
export const repairEditorCopy = {
  activitySubmitSuccess: "提交成功，一秒后返回活动页面",
  requiredMark: "必填",
  /** 参与维修人员区块：时长不分人，对全部参与者生效。 */
  participantsLabel: "参与维修人员",
  participantsCreatorTag: "创建人",
  participantsHint: "维修时长计入每位参与成员",
  participantsAddLabel: "输入姓名或昵称添加协作者",
  participantsAddPlaceholder: "输入姓名或昵称，选择匹配成员…",
  participantsMatches: "找到 {count} 位成员，选择即可添加",
  participantsNoMatches: "未找到匹配成员，请尝试其他姓名或昵称",
  participantsNoOptions: "暂无可添加的成员",
  /** 活动接待：候选只来自本场出勤成员，姓名/昵称均可搜索。 */
  participantsAttendanceAddLabel: "输入姓名或昵称添加本场出勤成员",
  participantsAttendancePlaceholder: "输入姓名或昵称，选择本场出勤成员…",
  participantsAttendanceNoMatches: "本场出勤成员中没有匹配的人，请检查姓名或昵称",
  participantsAttendanceNoOptions: "暂无可添加的本场出勤成员",
  participantsAttendanceHint: "仅可添加本场出勤成员，维修时长计入每位参与成员",
  participantsRemove: "移除",
  participantsRemoveLabel: "移除参与成员 {name}",
  participantsCount: "已选 {count} / {limit} 人",
  participantsLimit: "已到达上限",
  /** 表单是「先存草稿、再提交」两步，必填只针对提交那一刻。 */
  requiredNote: "草稿可暂不填完必填项",
  dateHint: "默认今天；不得晚于今天",
  deviceModelLabel: "机型",
  deviceModelPlaceholder: "如：联想小新 Air 14",
  deviceModelHint: `必填，最多 ${repairFieldLimits.deviceModelMaxLength} 字；填写品牌 + 型号即可`,
  /** 活动草稿会由接待落单带出报名机型。 */
  deviceModelActivityHint: "已自动带出客户预约时填写的机型，可直接修改",
  deviceModelRequired: "请填写机型",
  ownerNameLabel: "机主姓名",
  ownerNameHint: "请填写机主真实姓名",
  ownerPhoneLabel: "机主电话",
  ownerPhoneHint: "11 位中国大陆手机号",
  durationHint: `${repairFieldLimits.durationMinutesMin}–${repairFieldLimits.durationMinutesMax} 分钟，填写实际耗时`,
  remarkLabel: "备注",
  remarkHint: `选填，最多 ${repairFieldLimits.remarkMaxLength} 字。备注会展示在案例库摘要中，请勿填写机主电话等敏感信息`,
  /** 「备注 + 照片」合并块：照片从提交必填降级为选填附件。 */
  attachmentsTitle: "备注与附件",
  /** 照片上限来自服务端（随详情下发），所以文案留占位符而不是写死数字。 */
  photoHint: "支持 JPEG、PNG、WebP；单张不超过 {size}、最多 {count} 张。选填，可稍后补充",
  /** 新建 / 补单在确认页之前选照片，提交时随建单一起上传。 */
  photoCreateHint: "选填，支持 JPEG、PNG、WebP；单张不超过 {size}、最多 {count} 张，提交时一并上传",
  photoPendingNote: "照片暂存在当前页面，刷新或离开后需重新选择",
  photoSelectLabel: "选择照片",
  photoPreviewAlt: "待上传照片 {index}",
  photoRemove: "移除",
  photoRemoveLabel: "移除待上传照片 {index}",
  photoSelectTooMany: "最多还能再选 {remain} 张",
  photoLimitReached: "最多上传 {count} 张照片，已达到上限",
  photoTypeUnsupported: "仅支持 JPEG、PNG、WebP 图片",
  /** HEIC 本轮不转换（issue #324）：给出 iPhone 相机格式指引，不产生误导性成功。 */
  photoHeicUnsupported:
    "暂不支持 HEIC/HEIF 照片。iPhone 可在「设置 → 相机 → 格式」选择「兼容性最佳」，或先把照片转换为 JPEG 后重新上传。",
  photoCompressed: "已压缩 {before} → {after}",
  photoDropHint: "也可以把照片直接拖到这里",
  photoCameraLabel: "拍照上传",
  photoCameraHint: "手机端可直接调用相机；桌面端等同于选择文件",
  photoSelectedCount: "已选 {count} / {max} 张",
  photoStatusReady: "待上传",
  photoStatusPreparing: "正在压缩…",
  photoStatusUploading: "上传中 {percent}%",
  photoStatusSuccess: "已上传",
  photoStatusError: "上传失败",
  photoRetry: "重试",
  photoRetryLabel: "重试上传照片 {index}",
  photoUploadFailed: "「{name}」上传失败：{reason}",
  photoUploadSummaryFailed: "{count} 张照片上传失败，可逐张重试",
  photoUploadSuccess: "照片已上传。",
  /** 上传成功但列表刷新失败：照片已在服务端，不能让用户误以为丢失或重复上传。 */
  photoRefreshFailed: "照片已上传，但列表刷新失败，请刷新页面。",
  photoListRefreshFailed: "列表刷新失败，请刷新页面后重试。",
  photoDuplicateSkipped: "已跳过 {count} 张重复选择的照片",
  photoNoPendingUploads: "没有待上传的照片",
  /** 新建流程的同页两步：填写（含照片）→ 核对确认。 */
  createStepTitle: "填写维修记录",
  createStepHint: "填好信息并选好照片后，下一步核对再提交",
  nextStep: "下一步",
  confirmTitle: "确认维修记录",
  confirmIntro: "请核对填写内容与照片，确认后提交审核",
  confirmSubmit: "确认提交",
  submitting: "提交中…",
  backToEdit: "返回修改",
  retryUpload: "重试上传",
  goToDetail: "前往记录详情",
  recordCreatedUploadFailed:
    "记录已创建，但照片上传失败：{message}。请勿重新提交；可移除有问题的照片后重试，或前往记录详情补充",
  photosLabel: "照片",
  photosSubmitNote: "照片将在确认提交后上传；审核通过后不可修改",
  noPhotos: "未选择照片（选填）",
  repairDateLabel: "维修日期",
  categoryLabel: "故障分类",
  durationLabel: "维修时长（分钟）",
  resultLabel: "维修结果",
  /** 新建页从 sessionStorage 恢复未提交内容时的提示。 */
  createDraftRestored: "已恢复上次未提交的内容",
  /** 活动接待补单：不落草稿，提交时才创建维修单。 */
  serveStageAndBack: "暂存返回",
  serveSubmitNote: "未提交内容暂存在本机，可从「已接待」继续填写",
  /** 维修结果默认值提示：编辑存量记录可保存草稿；新建 / 接待补单只有提交。 */
  resultDefaultHint: "维修结果默认为「{result}」",
  resultDefaultHintSubmitOnly: "维修结果默认为「{result}」",
  photoTooLarge: "「{name}」有 {size}，超过单张 {limit} 的上限，请压缩或换一张",
  photoTooMany: "已上传 {count} 张，最多只能再传 {remain} 张",
};
/** 照片体积的可读写法：提示文案与服务端报错共用，避免两处各写一份换算。 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Number(mb.toFixed(mb >= 10 ? 0 : 1))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
/**
 * 参与维修人员的展示名：全部参与者「、」连接；创建人恒在首位（服务端保证）。
 * 列表、详情、案例卡共用一处写法；参与行缺失（理论不可能）时回退创建人本人。
 */
export function formatRepairParticipants(record: {
  member: { id: string; name: string };
  participants: Array<{ id: string; name: string }>;
}): string {
  return record.participants.length
    ? record.participants.map((participant) => participant.name).join("、")
    : record.member.name;
}
/** 成员端不填写维修结果，缺省按「已完成」记录；管理员仍可在管理端改成「未完成」。 */
export const defaultRepairResult: RepairResult = "COMPLETED";
export const repairTimelineLabels = {
  CREATED: "创建草稿",
  UPDATED: "修改记录",
  PHOTO_ADDED: "添加照片",
  PHOTO_REMOVED: "移除照片",
  SUBMITTED: "提交审核",
  RESUBMITTED: "重新提交",
  WITHDRAWN: "撤回审核",
  APPROVED: "审核通过",
  REJECTED: "审核退回",
  DELETED: "软删除",
  FLAG_CHANGED: "标记变化",
} as const;
