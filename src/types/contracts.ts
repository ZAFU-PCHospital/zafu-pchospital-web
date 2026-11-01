import type { FilterRule } from "@/lib/api/list-filter";
import type { SortRule, TableListOptions, TableListExtras } from "@/types/table";

/** Phase 2 public contract constants. Database values and API inputs must use these constants. */
export const UserStatus = ["ACTIVE", "DISABLED"] as const;
export const RoleCode = ["MEMBER", "ADMIN"] as const;
export const MemberStatus = ["ACTIVE", "REVOKED"] as const;
export const MemberDepartment = ["REPAIR", "PUBLICITY", "OFFICE"] as const;
export const IdentityType = ["PHONE", "QQ", "QQ_OAUTH", "WECHAT_OAUTH", "EMAIL"] as const;
export const JoinApplicationStatus = [
  "SUBMITTED",
  "INTERVIEW_PENDING",
  "INTERVIEW_PASSED",
  "INTERVIEW_REJECTED",
  "WITHDRAWN",
] as const;
export const InterviewResult = ["PASSED", "REJECTED"] as const;
export const ProvisionStatus = ["NOT_REQUIRED", "PENDING", "SUCCEEDED", "FAILED"] as const;
export const ProvisionSourceType = [
  "JOIN_APPLICATION",
  "INVITE_REDEMPTION",
  "ADMIN_CREATED",
] as const;
export const InviteCodeStoredStatus = ["ACTIVE", "REVOKED"] as const;
export const InviteCodeEffectiveStatus = [
  "NOT_STARTED",
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
  "EXHAUSTED",
] as const;
export const AuditActorType = ["USER", "SYSTEM"] as const;
export const RepairStatus = ["DRAFT", "PENDING", "APPROVED", "REJECTED"] as const;
export const RepairResult = ["COMPLETED", "NOT_COMPLETED"] as const;
export const RepairReviewDecision = ["APPROVED", "REJECTED"] as const;
export const RepairTimelineEventType = [
  "CREATED",
  "UPDATED",
  "PHOTO_ADDED",
  "PHOTO_REMOVED",
  "SUBMITTED",
  "RESUBMITTED",
  "WITHDRAWN",
  "APPROVED",
  "REJECTED",
  "DELETED",
  "FLAG_CHANGED",
] as const;
export const NotificationType = ["REPAIR_APPROVED", "REPAIR_REJECTED"] as const;
export const NotificationStatus = ["UNREAD", "READ"] as const;

type ValueOf<T extends readonly string[]> = T[number];

export type UserStatus = ValueOf<typeof UserStatus>;
export type RoleCode = ValueOf<typeof RoleCode>;
export type MemberStatus = ValueOf<typeof MemberStatus>;
export type MemberDepartment = ValueOf<typeof MemberDepartment>;
export type IdentityType = ValueOf<typeof IdentityType>;
export type JoinApplicationStatus = ValueOf<typeof JoinApplicationStatus>;
export type InterviewResult = ValueOf<typeof InterviewResult>;
export type ProvisionStatus = ValueOf<typeof ProvisionStatus>;
export type ProvisionSourceType = ValueOf<typeof ProvisionSourceType>;
export type InviteCodeStoredStatus = ValueOf<typeof InviteCodeStoredStatus>;
export type InviteCodeEffectiveStatus = ValueOf<typeof InviteCodeEffectiveStatus>;
export type AuditActorType = ValueOf<typeof AuditActorType>;
export type RepairStatus = ValueOf<typeof RepairStatus>;
export type RepairResult = ValueOf<typeof RepairResult>;
export type RepairReviewDecision = ValueOf<typeof RepairReviewDecision>;
export type RepairTimelineEventType = ValueOf<typeof RepairTimelineEventType>;
export type NotificationType = ValueOf<typeof NotificationType>;
export type NotificationStatus = ValueOf<typeof NotificationStatus>;

/* ------------------------------------------------------------------ M5 统计 */

/** 统计范围。`ACADEMIC_YEAR` 固定为 9/1 → 次年 9/1；ALL_TIME 不附加任何日期条件。 */
export const AnalyticsScope = ["MONTH", "ACADEMIC_YEAR", "ALL_TIME"] as const;
/** 排行主指标。时长始终以整数分钟入库与比较，小时只在 UI 层格式化。 */
export const RankingMetric = ["REPAIR_COUNT", "DURATION_MINUTES"] as const;
export type AnalyticsScope = ValueOf<typeof AnalyticsScope>;
export type RankingMetric = ValueOf<typeof RankingMetric>;

/* ------------------------------------------------------------------ M6 管理后台 */

/** 导出格式。两者共用同一条数据路径（`RepairExportRow[]`），只在出口处分叉。 */
export const ExportFormat = ["CSV", "XLSX"] as const;
export type ExportFormat = ValueOf<typeof ExportFormat>;

/**
 * 单次导出行数上限。超过即拒绝（`EXPORT_ROW_LIMIT_EXCEEDED`），**不得**静默截断 ——
 * 静默截断会让管理员以为拿到了全量数据。
 */
export const EXPORT_MAX_ROWS = 20000;
/** 批量操作单次上限。逐条调用既有 Service，因此上限也是事务次数的上限。 */
export const ADMIN_BATCH_LIMIT = 50;

/** `GET /api/v1/admin/repairs/export` 的入参：与列表完全相同的筛选，去掉分页。 */
export type RepairExportInput = Omit<RepairListInput, "page" | "pageSize">;

/** 导出行。列顺序即表头顺序，CSV 与 XLSX 共用。 */
export type RepairExportRow = {
  repairDate: string;
  memberName: string;
  /** 参与成员：全部参与者、「、」连接；创建人也在列（便于单列回答「谁做过这条」）。 */
  participantNames: string;
  ownerName: string;
  ownerPhone: string;
  categoryName: string;
  result: string;
  durationMinutes: string;
  status: string;
  createdAt: string;
  /** 记录 ID 与照片 URL，按需求「图片不嵌入 Excel，只输出链接或记录 ID」。 */
  repairRecordId: string;
  photoUrls: string;
};

export type RepairExportResult = {
  format: ExportFormat;
  fileName: string;
  contentType: string;
  /**
   * 导出字节流。用 `Uint8Array<ArrayBuffer>` 而不是 Node 的 `Buffer`：
   * 契约文件会被客户端组件间接引用，且 `Response` 的 `BodyInit` 只接受
   * `ArrayBuffer` 支撑的视图（与 `lib/security/secrets.ts` 的 `digest` 同一处理）。
   */
  body: Uint8Array<ArrayBuffer>;
  rowCount: number;
};

export const Permission = [
  "join:submit",
  "join:read",
  "join:review",
  "member:provision",
  "member:manage",
  "invite:create",
  "invite:read",
  "invite:revoke",
  "invite:redeem",
  "audit:read",
  "repair:create",
  "repair:read",
  "repair:update",
  "repair:submit",
  "repair:review",
  "repair:delete",
  "repair:flag",
  "repair:category:manage",
  "member.profile.read_self",
  "member.profile.update_self",
  "member.profile.read_internal",
  "member.skill.assign_self",
  "favorite:manage",
  "notification:read",
  "analytics:read_internal",
  // M6 管理后台：导出会把成员姓名、学号等写进站外文件，因此单列一个权限码，
  // 不复用 repair:review —— 维修审核与「把数据带出系统」是两件事。
  "data:export",
  // M6 批次 2。
  // 技能标签库与故障分类是两类资源，各自管理；不复用 `member:manage`
  // （那是「给某个成员分配标签」，和「维护标签库本身」不是一件事）。
  "skill:manage",
  // 公开统计展示策略决定官网对外展示什么，与站内管理操作分开。
  "settings:manage",
  // 维修活动：管理 CRUD / 报名管理 vs 成员出勤签到接待。
  "activity:admin",
  "activity:staff",
] as const;
export type Permission = ValueOf<typeof Permission>;

export type RequestContext = {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

export type PublicRequestContext = RequestContext;

export type AuthorizedActor = RequestContext & {
  actorType: AuditActorType;
  userId?: string;
  userStatus: UserStatus;
  permissions: readonly Permission[];
  mustChangePassword?: boolean;
};

export type LoginInput = { qq: string; password: string; rememberMe?: boolean };
export type SessionPrincipal = {
  userId: string;
  displayName: string | null;
  roles: RoleCode[];
  permissions: Permission[];
  memberProfileId: string | null;
  memberStatus: MemberStatus | null;
  mustChangePassword: boolean;
};
export type AuthSessionResult = SessionPrincipal & {
  sessionId: string;
  token: string;
  expiresAt: string;
};

/**
 * 账号在当前门禁档位下的访问结论。
 *
 * 判定顺序固定：有效 Session / 账号资格 → 必须改密 → 当前模式需要邮箱且无有效豁免 →
 * 合法原目标或角色默认页。每次受保护请求都按**当次服务端持久化状态**重判，
 * 不缓存进登录快照，也不由前端标志、请求参数或存储决定。
 */
export type AccountAccessState =
  "PASSWORD_CHANGE_REQUIRED" | "EMAIL_VERIFICATION_REQUIRED" | "READY";

/** 页面守卫、业务 API 与 `/me` 共用的同一份结论。 */
export type AccountAccessView = {
  state: AccountAccessState;
  /** 服务端给出的落点：受限时为对应步骤页，放行时为合法原目标或角色默认页。 */
  destination: string;
  /** 有效豁免的到期时间（供会话监测提前复查）；无豁免为 `null`。不含豁免原因 / 邮箱明文。 */
  exemptionExpiresAt: string | null;
};

/** `/api/v1/me` 载荷：Session 主体原字段全部保留，追加当前门禁结论（受限有效会话仍 200）。 */
export type AccountMeView = SessionPrincipal & {
  sessionId: string;
  expiresAt: string;
  rememberMe: boolean;
  accountAccess: AccountAccessView;
};
export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
};

export type PaginationInput = { page: number; pageSize: number };
export type TableListInput = PaginationInput & TableListOptions;

export type PaginationMeta = PaginationInput & {
  total: number;
  totalPages: number;
};

export type SubmitJoinApplicationInput = {
  recruitmentCycle: string;
  realName: string;
  qq: string;
  phone: string;
  /** 报名通知地址，必填；不代表已验证的账号邮箱。 */
  email: string;
  /**
   * 学号 / 班级：**必填**。约束与邀请码注册同一来源
   * （`src/lib/security/normalization.ts`）：学号 trim 后 1–32 字符、保留前导零、不唯一；
   * 班级 trim 后 1–80 字符。历史报名没有这两列（读模型保持可空），新提交由服务端保证必填。
   */
  studentId: string;
  className: string;
  selfIntroduction?: string;
  preferredDirection?: string;
  applicantRemark?: string;
  privacyConsent: boolean;
};

export type JoinReceipt = {
  id: string;
  ticketNo: string;
  status: JoinApplicationStatus;
  submittedAt: string;
  duplicate: boolean;
};

export type ReviewJoinApplicationInput = {
  applicationId: string;
  result: InterviewResult;
  /** 首次通过必填；重复通过 / 补记备注不改变已保存的录取部门。 */
  admittedDepartment?: MemberDepartment;
  interviewedAt: string;
  internalNote?: string;
  idempotencyKey: string;
};

export type JoinApplicationView = {
  id: string;
  status: JoinApplicationStatus;
  provisionStatus: ProvisionStatus;
  admittedDepartment: MemberDepartment | null;
  lastReviewedAt: string | null;
  initializationSecret?: string;
};

export type JoinApplicationListInput = TableListInput & {
  /** 精确匹配历史或当前招募批次，空白视为不筛选。 */
  recruitmentCycle?: string;
  status?: JoinApplicationStatus;
  provisionStatus?: ProvisionStatus;
  submittedFrom?: string;
  submittedTo?: string;
  query?: string;
};

export type JoinApplicationSummary = JoinApplicationView & {
  /** 首次通过操作的服务端记录时间；历史无审核记录时为 null。 */
  approvedAt: string | null;
  ticketNo: string;
  recruitmentCycle: string;
  realName: string;
  qqMasked: string;
  phoneMasked: string;
  submittedAt: string;
};

export type JoinApplicationDetail = JoinApplicationView & {
  ticketNo: string;
  recruitmentCycle: string;
  realName: string;
  /** 学号 / 班级：历史报名为 `null`（未填写），界面显示 `—`。 */
  studentId: string | null;
  className: string | null;
  qq: string;
  phone: string;
  /** 仅授权详情披露；历史报名可为 null。 */
  email: string | null;
  notification: AccountNotificationView | null;
  selfIntroduction: string | null;
  preferredDirection: string | null;
  applicantRemark: string | null;
  submittedAt: string;
  reviews: Array<{
    id: string;
    result: string;
    interviewedAt: string;
    internalNote: string | null;
  }>;
};

/** 更正报名通知邮箱：邮箱只作通知用，账号邮箱仍由登录后验证绑定。 */
export type CorrectJoinNotificationEmailInput = { email: string };

/**
 * 更正结果。`notification` 为更正后的通知任务状态（没有任务时为 null）——
 * 发送中会被拒绝；已交发信服务 / 结果未知只更新报名记录，任务本身不动。
 */
export type JoinNotificationEmailCorrection = {
  email: string;
  notification: AccountNotificationView | null;
};

export type CreateInviteCodeInput = {
  activeFrom?: string | null;
  expiresAt?: string | null;
  maxUses: number;
  boundQq?: string;
  boundPhone?: string;
};

export type UpdateInviteCodeInput = {
  activeFrom?: string | null;
  expiresAt?: string | null;
  maxUses?: number;
};

export type InviteCodeView = {
  id: string;
  displayPrefix: string;
  status: InviteCodeEffectiveStatus;
  activeFrom: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
};

export type CreateInviteCodeResult = InviteCodeView & { plainCode: string };

export type RedeemInviteCodeInput = {
  code: string;
  idempotencyKey: string;
  realName: string;
  qq: string;
  phone: string;
  /** 学号 / 班级：**必填**，约束来源与公开招募同一份（`normalization.ts`）。 */
  studentId: string;
  className: string;
  password: string;
};

export type ProvisionView = {
  id: string;
  status: ProvisionStatus;
  userId: string | null;
  memberProfileId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
};

export type ProvisionResult = ProvisionView & { initializationSecret?: string };

export type MemberRegistrationResult = {
  userId: string;
  memberProfileId: string;
  redemptionId: string;
  provisionId: string;
};

/**
 * 邀请码注册成功的响应载荷：注册结果 + 服务端统一落点。
 *
 * 注册本身不新增邮箱字段：先完成注册与建会话，再由 `accountAccess` 决定下一步
 * （需要验证邮箱时进邮箱步骤，否则进角色默认页）。前端不再固定跳 `/member`。
 */
export type InviteRegistrationResponse = MemberRegistrationResult & {
  accountAccess: AccountAccessView;
  destination: string;
};

export type CreateMemberInput = {
  realName: string;
  qq: string;
  phone: string;
  studentId?: string;
  className?: string;
  nickname?: string;
  department?: MemberDepartment;
  idempotencyKey: string;
};

export type MemberView = {
  id: string;
  userId: string;
  realName: string;
  department: MemberDepartment;
  nickname: string | null;
  studentId: string | null;
  className: string | null;
  status: MemberStatus;
};
export type MemberMutationResult = {
  member: MemberView;
  initializationSecret?: string;
  /** 临时密码到期时间：仅管理员重置 / 账号恢复签发时存在。 */
  temporaryExpiresAt?: string;
};

/**
 * 「账号恢复」精确查询入口：按 QQ 精确定位账号，返回管理操作所需的
 * 最小信息 —— 不含 QQ / 手机号明文，不返回密码状态细节，避免变成账号检索平台。
 *
 * `blockedReason` 与登录资格判定（`readPrincipal`）同义：
 * `SELF` 不能自我恢复（服务端拒绝，不只隐藏按钮）；`DISABLED` 账号不可用 / 已删除；
 * `MEMBER_INACTIVE` 成员身份被撤且无管理员角色，重置也登不进来。
 */
export type AdminAccountLookupInput = { qq: string };

export type AdminAccountLookupResult = {
  userId: string;
  displayName: string | null;
  roles: RoleCode[];
  canReset: boolean;
  blockedReason: "SELF" | "DISABLED" | "MEMBER_INACTIVE" | null;
};

/**
 * 账号恢复签发结果：明文口令仅出现在本次成功响应里（`private, no-store`），
 * 后端只存 scrypt 哈希；`temporaryExpiresAt` 必须随口令一起展示给管理员转达。
 */
export type AdminAccountResetResult = {
  userId: string;
  displayName: string | null;
  roles: RoleCode[];
  initializationSecret: string;
  temporaryExpiresAt: string;
};

/**
 * 管理端编辑成员后的返回值：{@link MemberView} 之上带**新的 `version`**。
 *
 * 为什么必须带：编辑走乐观锁（`version` 每次成功自增）。就地编辑要能**连续改同一行**，
 * 界面就必须在每次成功后拿到新的版本号 —— 否则第二次提交用的还是旧版本，必然 409。
 *
 * 另一条路是「编辑成功后整表重取」，但那会把无限下翻出来的几页缩回第一页
 * （与拖动排序同一个坑，见 `useAdminList.reorder` 的注释），所以不选它。
 */
export type MemberUpdateView = MemberView & { version: number };

/* --------------------------------------------------- M6 成员管理（管理端） */

/**
 * 管理端成员列表筛选。
 * `query` 只做「姓名 / 昵称 / 学号 / 班级 / 已脱敏 QQ / 手机号」的模糊匹配，
 * **不返回明文联系方式** —— 明文只在成员详情里出现，且读取要写审计。
 */
export type MemberListInput = TableListInput & {
  query?: string;
  status?: MemberStatus;
  role?: RoleCode;
  /**
   * 排序规则。字段必须落在 `MEMBER_SORTABLE` 白名单内 ——
   * 解析在 `member-http.ts`（`sortRules`，非法值 → `VALIDATION_FAILED`），
   * 映射到列在 `member-sort.ts`（`memberOrderBy`）。
   *
   * 省略或空数组时按服务端默认顺序（新成员在前），**不是**「不排序」：
   * 顺序不确定时，无限下翻的分页会重复或漏行。
   */
  sort?: SortRule[];
  /**
   * 列级筛选条件（`filter=<field>:<op>:<value>`，可重复）。
   * 字段与运算符白名单见 `MEMBER_FILTERABLE`，映射见 `member-filter.ts`。
   *
   * 与 `query` 的区别：`query` 是跨列关键字搜索，这里是**逐列的精确条件**，两者可同时用。
   */
  filters?: FilterRule[];
};

/** 列表条目。QQ 与手机号一律脱敏（`maskQq` / `maskPhone`）。 */
export type MemberListEntry = {
  id: string;
  userId: string;
  realName: string;
  department: MemberDepartment;
  nickname: string | null;
  studentId: string | null;
  className: string | null;
  status: MemberStatus;
  roles: RoleCode[];
  /** 账号是否被停用。`memberProfile.status` 为 `REVOKED` 时用户仍可能保留管理员角色。 */
  userStatus: UserStatus;
  /**
   * 技能标签。
   *
   * 只带展示需要的三个字段，顺序与成员端一致（按标签库的 `sortOrder`）；
   * 完整标签库在 `/api/v1/admin/skills`。**不是敏感信息**，与 QQ / 手机号不同 ——
   * 那两个仍然只在详情接口里给明文。
   */
  skills: MemberSkillTag[];
  qqMasked: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  emailVerified: boolean;
  /** 正式统计口径：`APPROVED AND deletedAt IS NULL` 的记录数。 */
  approvedRepairCount: number;
  /** 同一口径的维修总时长（分钟）。列表里与次数同格显示，明细见成员详情的统计。 */
  approvedRepairMinutes: number;
  joinedAt: string;
  version: number;
};

/** 成员身上的一枚技能标签（列表用；`isActive` 为 false 表示该标签已被停用）。 */
export type MemberSkillTag = { id: string; name: string; isActive: boolean };

export type MemberListResult = TableListExtras & {
  items: MemberListEntry[];
  pagination: PaginationMeta;
};

/** 成员导出与列表共用筛选和排序，不导出分页、分组或邮箱信息。 */
export type MemberExportInput = Omit<MemberListInput, "page" | "pageSize" | "groupBy">;
export type MemberExportResult = RepairExportResult;

export interface MemberExportServiceContract {
  export(
    input: MemberExportInput,
    format: ExportFormat,
    actor: AuthorizedActor,
  ): Promise<MemberExportResult>;
}

/** 成员详情。管理端**唯一**返回 QQ / 手机号明文的位置，读取必须写审计。 */
export type MemberDetail = MemberListEntry & {
  qq: string | null;
  phone: string | null;
  skills: SkillView[];
};

export type UpdateMemberInput = {
  department?: MemberDepartment;
  realName?: string;
  studentId?: string | null;
  className?: string | null;
  nickname?: string | null;
  /** 乐观锁：必须回传列表/详情里拿到的版本号。 */
  version: number;
};

/** 设置角色。必须是角色的**全量集合**，不是增量。 */
export type SetMemberRolesInput = { roles: readonly RoleCode[] };

export type MemberBatchToggleInput = {
  memberIds: readonly string[];
  enabled: boolean;
};

/**
 * 批量结果。逐条调用既有 `setEnabled`，因此**允许部分成功**，
 * 每条失败都带稳定错误码，界面必须逐条展示而不是只报一句“失败”。
 */
export type MemberBatchToggleResult = {
  succeeded: string[];
  failed: { memberId: string; code: string; message: string }[];
};

export type RepairPhotoView = {
  id: string;
  /** display 变体：新照片为 1280 长边 WebP；回填前历史照片为原图。 */
  contentUrl: string;
  /** 320 长边缩略图；历史照片回填前回退为 contentUrl。 */
  thumbnailUrl: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  /** display 变体像素尺寸；历史照片回填前为 null。 */
  width: number | null;
  height: number | null;
  sortOrder: number;
  createdAt: string;
};
export type RepairCategoryView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

/** 管理端分类视图：多一个引用计数，用来回答「能不能停用 / 有没有人用」。 */
export type RepairCategoryAdminView = RepairCategoryView & {
  /** 引用它的未软删除维修记录条数。> 0 说明该分类已有历史数据，只能停用不能物理删除。 */
  usedByRepairCount: number;
  createdAt: string;
};
export type RepairMemberOption = {
  id: string;
  name: string;
  /** 全局与活动接待候选均下发姓名 / 昵称供搜索；仅展示的已选成员可省略。 */
  realName?: string | null;
  nickname?: string | null;
};
/** 参与维修的成员：`id` 为成员档案 id，创建人恒排第一。 */
export type RepairParticipantView = { id: string; name: string };
export type RepairTimelineView = {
  id: string;
  eventType: RepairTimelineEventType;
  summary: unknown;
  actorName: string | null;
  createdAt: string;
};
export type RepairReviewView = {
  id: string;
  decision: RepairReviewDecision;
  note: string | null;
  reviewerName: string | null;
  createdAt: string;
};
export type RepairView = {
  id: string;
  /** 创建人（主维修人，即 `repair_records.member_profile_id`），列表与详情均以他为准。 */
  member: { id: string; name: string };
  /**
   * 参与维修的成员：含创建人本人、创建人恒排第一。
   * 时长不分人：记录的 `durationMinutes` 对全部参与者生效（每人各自计入统计）。
   */
  participants: RepairParticipantView[];
  repairDate: string | null;
  durationMinutes: number | null;
  category: RepairCategoryView | null;
  /** 机型：成员在表单填写（提交审核必填），活动接待时会先带出报名机型；历史记录可能为 null。 */
  deviceModel: string | null;
  /** 机主（客户）姓名：接待落单带自报名，手工建单由成员填写；旧数据为 null。 */
  ownerName: string | null;
  /**
   * 机主（客户）电话完整号。
   *
   * 可见性口径（fail-closed）：仅记录归属人与具备 `repair:review` 权限者拿到完整号，
   * 其余一律为 `null`（既不下发掩码也不下发完整号）。**非可选字段**，
   * 消费方不必判断字段是否存在，只需判断是否为 null。
   */
  ownerPhone: string | null;
  content: string | null;
  result: RepairResult | null;
  remark: string | null;
  status: RepairStatus;
  isDifficult: boolean;
  isTypical: boolean;
  version: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  photos: RepairPhotoView[];
};
export type RepairDetailView = RepairView & {
  reviews: RepairReviewView[];
  timeline: RepairTimelineView[];
  canEdit: boolean;
  /**
   * 记录本人能否在详情页补照片。
   *
   * `DRAFT` / `REJECTED` 与「本人未审核的 `PENDING`」为 true；审核通过后 false。
   * 仅控制界面入口，服务端仍会在照片写接口内复核。
   */
  canAttachPhotos: boolean;
  canReview: boolean;
  canFlag: boolean;
  isFavorited: boolean;
  /**
   * 照片上传上限，以服务端 `.env`（`UPLOAD_MAX_BYTES` / `UPLOAD_MAX_FILES_PER_REPAIR`）为准。
   *
   * 随详情一起下发，是为了让前端提前拦下超限文件、并把真实数字写进提示 ——
   * 前端各写一份常量会出现「提示说 10 MB、服务端按 5 MB 拒绝」。
   */
  photoLimits: { maxBytes: number; maxFiles: number };
};
export type RepairDraftFields = {
  repairDate?: string | null;
  durationMinutes?: number | null;
  categoryId?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  /**
   * 机型：成员填写 / 修改，提交审核时必填；草稿允许为空（活动落单可能还没带出）。
   * 缺省（`undefined`）表示「不动」，`null` / 空白表示清空。
   */
  deviceModel?: string | null;
  content?: string | null;
  result?: RepairResult | null;
  remark?: string | null;
  /**
   * 参与维修人员：**不含创建人本人**的成员档案 id 列表，按添加顺序。
   * 缺省（`undefined`）表示「不动」；显式空数组表示「清空额外参与者」。
   * 服务端按整体替换处理：去重、去掉创建人本人、校验成员存在。
   */
  participantIds?: string[];
};
export type CreateRepairDraftInput = RepairDraftFields & { idempotencyKey: string };
/** 提交即建单：与草稿同形，但直接创建 PENDING 记录。 */
export type CreateSubmittedRepairInput = RepairDraftFields & { idempotencyKey: string };
export type UpdateRepairInput = RepairDraftFields & { version: number };
export type SubmitRepairInput = { version: number; idempotencyKey: string };
export type ReviewRepairInput = {
  decision: RepairReviewDecision;
  note?: string;
  idempotencyKey: string;
};

/* --------------------------------------------------- M6 维修管理（管理端） */

/**
 * 管理端修改异常数据。
 *
 * 与成员自己的 `UpdateRepairInput` 有三处不同：
 * 1. 允许修改任意状态（含 `APPROVED`）的记录 —— 需求 §36 的「修改异常数据」；
 * 2. `reason` 必填，写入时间线与审计，回答「为什么改」；
 * 3. **不改状态**：管理员改数据不触发重新审核，`APPROVED` 改动后仍是 `APPROVED`。
 *    统计口径始终是「当前值的唯一来源」，不引入快照表，因此历史统计只会随当前值重算，
 *    不会出现两份互相矛盾的数据。改动前后的差异留在 `AuditLog.before/after` 与时间线里。
 */
export type RepairAdminUpdateInput = RepairDraftFields & {
  version: number;
  reason: string;
};

export type RepairBatchReviewInput = {
  recordIds: readonly string[];
  decision: RepairReviewDecision;
  note?: string;
  /** 批量键；逐条派生成 `{key}:{recordId}` 作为各记录自己的幂等键。 */
  idempotencyKey: string;
};

/** 批量审核逐条结果，允许部分成功。 */
export type RepairBatchReviewResult = {
  succeeded: string[];
  failed: { recordId: string; code: string; message: string }[];
};
export type RepairFlagsInput = { isDifficult: boolean; isTypical: boolean };
export type RepairListInput = TableListInput & {
  memberId?: string;
  categoryId?: string;
  status?: RepairStatus;
  result?: RepairResult;
  repairDateFrom?: string;
  repairDateTo?: string;
  isDifficult?: boolean;
  isTypical?: boolean;
  /**
   * 案例库准入：`"ANY"` 表示「被标记为典型案例或疑难案例之一」
   * （并集）。与 `isTypical` / `isDifficult` 的关系：那两个是**平铺 AND** 语义
   * （都传=要求两条都标），表达不了并集，故另立此字段。
   * 缺省 = 不过滤；`RepairExportInput` 继承它但导出不传，行为零变化。
   */
  flagged?: "ANY";
  query?: string;
  /**
   * 排序规则。字段必须落在 `REPAIR_SORTABLE` 白名单内 ——
   * 解析在 `repair-http.ts`（`sortRules`），映射到列在 `repair-sort.ts`（`repairOrderBy`）。
   *
   * 列表与导出共用此排序；未指定时沿用维修日期倒序。
   */
  sort?: SortRule[];
};
export type RepairListResult = TableListExtras & {
  items: RepairView[];
  pagination: PaginationMeta;
};
/**
 * 新增故障分类。
 *
 * `code` 与 `sortOrder` 都**改由系统生成**：
 * - `code` 是稳定标识，管理员不该为了加一个「散热清灰」去编一个英文 code，
 *   留空时由 `stableCodeFromName` 按名称生成（见 `src/lib/stable-code.ts`）；
 * - `sortOrder` 留空时排到末尾，顺序由列表里的「上移 / 下移」调整
 *   （让用户手填一个 10/20/30 的整数去控制顺序，是把系统的活儿推给人）。
 */
export type CreateRepairCategoryInput = {
  code?: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
};

/** 排序调整方向。一次只挪一格，避免出现「拖到第 3 位」这类需要猜位次的输入。 */
export const ReorderDirection = ["UP", "DOWN"] as const;
export type ReorderDirection = ValueOf<typeof ReorderDirection>;
export type UpdateRepairCategoryInput = {
  name?: string;
  description?: string | null;
  sortOrder?: number;
};

// ---------------------------------------------------------------------------
// M6 批次 2（管理端）：技能标签库 / 邀请码 / 审计 / 公开统计配置 / 报名导出
// ---------------------------------------------------------------------------

/** 技能标签库管理视图。`usedByMemberCount` 只统计**当前生效**的成员关联，回答「停用会不会影响人」。 */
export type SkillAdminView = SkillView & { usedByMemberCount: number };

/** 技能名称上限：管理端新建与成员自建共用同一条规则，列宽 `VarChar(80)`。 */
export const SKILL_NAME_MAX_LENGTH = 80;

/** 新增技能标签。`code` / `sortOrder` 同 {@link CreateRepairCategoryInput}，由系统生成。 */
export type CreateSkillInput = {
  code?: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
};

export type UpdateSkillInput = {
  name?: string;
  description?: string | null;
  sortOrder?: number;
};

/** 邀请码管理列表入参。`status` 是**生效状态**（含派生的过期/用尽），不是存储状态。 */
export type InviteCodeListInput = TableListInput & {
  status?: InviteCodeEffectiveStatus;
  query?: string;
};

/**
 * 邀请码管理视图。
 *
 * `displayPrefix` 是明文的前 8 位（列表里用于人工核对），**完整明文只在创建响应里出现一次**：
 * 库里只存 `codeDigest`，任何列表都取不回完整邀请码。绑定信息按 PII 规则脱敏。
 */
export type InviteCodeAdminView = InviteCodeView & {
  boundQqMasked: string | null;
  boundPhoneMasked: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type InviteCodeListResult = TableListExtras & {
  items: InviteCodeAdminView[];
  pagination: PaginationMeta;
};

export const AuditResult = ["SUCCESS", "FAILURE"] as const;
export type AuditResult = ValueOf<typeof AuditResult>;

export type AuditLogListInput = TableListInput & {
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  result?: AuditResult;
  createdFrom?: string;
  createdTo?: string;
};

/**
 * 审计条目。
 *
 * `beforeSummary` / `afterSummary` 在**写入时**就已经过 `redactAuditSummary` 脱敏
 * （凭据类字段整条丢弃、QQ / 手机号打码），因此读取时不再二次处理；
 * 也正因如此，「查看审计」本身不再写一条审计 —— 那会变成自我增殖的记录流。
 */
export type AuditLogEntry = {
  id: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  /** 操作者展示名（昵称 / 实名 / 账号名回退）。系统写入为 `null`。 */
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  result: AuditResult;
  errorCode: string | null;
  beforeSummary: unknown;
  afterSummary: unknown;
  createdAt: string;
};

export type AuditLogListResult = TableListExtras & {
  items: AuditLogEntry[];
  pagination: PaginationMeta;
};

/** 审计动作筛选项：按出现次数降序，供筛选下拉使用（避免管理员手打动作名）。 */
export type AuditActionOption = {
  action: string;
  count: number;
};

/** 公开排行榜的展示名策略（需求 §33 / §74）。QQ、学号、后台 ID 一律不可公开。 */
export const RankingDisplayNameMode = ["REAL_NAME", "NICKNAME", "HIDDEN"] as const;
export type RankingDisplayNameMode = ValueOf<typeof RankingDisplayNameMode>;

/**
 * 公开内容与展示策略（`/admin/settings`，需求 §31 / §32 / §74）。
 *
 * 单行配置表，**默认全部关闭**：在管理员明确打开之前，官网首页不展示任何真实统计，
 * 公开首页只消费显式启用的数据，不因配置缺失而意外暴露内部数据。
 */
export type PublicContentSettings = {
  /** 首页展示累计维修设备数（需求 §31）。 */
  publicRepairStatsEnabled: boolean;
  /** 首页额外展示本学年维修数与累计维修时长（需求 §31 的辅助数据，口径为固定学年）。 */
  publicRepairStatsDetailEnabled: boolean;
  /** 首页展示简化排行榜（需求 §32）。 */
  publicRankingsEnabled: boolean;
  /** 排行榜展示名：真实姓名 / 仅昵称 / 隐藏（需求 §74）。 */
  rankingDisplayName: RankingDisplayNameMode;
  updatedAt: string | null;
  updatedBy: { userId: string; name: string } | null;
};

export type UpdatePublicContentSettingsInput = {
  publicRepairStatsEnabled: boolean;
  publicRepairStatsDetailEnabled: boolean;
  publicRankingsEnabled: boolean;
  rankingDisplayName: RankingDisplayNameMode;
};

/** 首页专用公开 DTO：不携带成员 ID、头像、联系方式或后台配置修改人。 */
export type PublicHomeAnalytics = {
  /** 本次统计使用的学年（固定 9/1 → 次年 9/1，Asia/Shanghai）；两块都隐藏时仍给出，
   *  让标题与注脚写的是**同一段**区间，而不是各自再取一次时钟。 */
  academicYear: { label: string; startInclusive: string; endExclusive: string };
  repairStats: {
    totalApprovedCount: number;
    /** 辅助开关关闭时整个 details 缺省，不向浏览器下发隐藏数据。 */
    details?: {
      yearApprovedCount: number;
      totalApprovedDurationMinutes: number;
    };
  } | null;
  rankings: {
    items: { rank: number; displayName: string; approvedCount: number }[];
  } | null;
};

/**
 * 报名数据导出行（需求 §4.4「查看、筛选和导出新成员报名数据」）。
 *
 * 与维修导出分开列模型：报名导出**故意包含 QQ 与手机号明文** —— 招募联系本人需要它，
 * 而需求 §34 对维修导出的要求是可核对的记录 ID，两者口径不同。
 * 因此这条路径使用独立权限与审计动作，不复用 `repair.exported`。
 */
export type JoinApplicationExportRow = {
  ticketNo: string;
  recruitmentCycle: string;
  realName: string;
  /** 学号：列在姓名后；历史空值导出空字符串，不写字面量 `null`。 */
  studentId: string;
  className: string;
  qq: string;
  phone: string;
  status: string;
  provisionStatus: string;
  preferredDirection: string;
  submittedAt: string;
  lastReviewedAt: string;
  applicationId: string;
};

export type JoinApplicationExportInput = Omit<JoinApplicationListInput, "page" | "pageSize">;

export type JoinApplicationExportResult = RepairExportResult;

// ---------------------------------------------------------------------------
// M3 成员工作台与个人主页
// ---------------------------------------------------------------------------

/** 指标值。`UNAVAILABLE` 表示本次聚合失败（区块降级），此时 `value` 必须为 null，
 *  页面显示「暂不可用」，绝不回退为伪造的 0。学年口径固定可算，不再有「未配置」态。 */
export type MetricStatus = "AVAILABLE" | "UNAVAILABLE";
export type MetricValue = {
  value: number | null;
  status: MetricStatus;
};

export const SkillStatus = ["ACTIVE", "INACTIVE"] as const;
export type SkillStatus = ValueOf<typeof SkillStatus>;

/** 技能标签展示视图。含 code 便于前端按稳定机器码分支，不依赖名称文案。 */
export type SkillView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

/** 成员资料摘要：工作台欢迎区与个人主页共用的最小身份信息。
 *  不含 QQ、学号、班级、userId —— 那些只在受保护的单成员内部详情出现。 */
export type MemberProfileSummary = {
  memberProfileId: string;
  displayName: string;
  nickname: string | null;
  realName: string | null;
  avatarUrl: string | null;
  status: string;
  joinedAt: string;
  roles: RoleCode[];
  skills: SkillView[];
  version: number;
};

/** 自我可见的完整资料（`/member/profile`）。QQ 只在此处出现，且页面标注「内部可见」。 */
export type MemberSelfProfile = MemberProfileSummary & {
  qq: string | null;
  studentId: string | null;
  className: string | null;
  /** 性别等扩展字段留待 M6；此处置空表示不受 M3 管理。 */
  editableFields: readonly ["nickname", "skills"];
};

/** 他人内部主页视图（`/member/profile/[memberProfileId]`）。
 *  比 self 更窄：不含学号、班级、账号状态细节与管理字段。 */
export type MemberInternalProfile = MemberProfileSummary & {
  qq: string | null;
};

export type MemberRecentRepair = {
  id: string;
  repairDate: string | null;
  durationMinutes: number | null;
  categoryName: string | null;
  result: string | null;
  contentExcerpt: string;
  updatedAt: string;
};

/** 工作台「最近操作」条目。可包含未通过记录，因此字段与 `MemberRecentRepair` 区分，
 *  带显式 status，禁止冒充「已通过维修」。 */
export type MemberRecentActivity = {
  id: string;
  status: RepairStatus;
  repairDate: string | null;
  contentExcerpt: string;
  updatedAt: string;
};

export type MemberRepairSummary = {
  totalApprovedCount: MetricValue;
  yearApprovedCount: MetricValue;
  monthApprovedCount: MetricValue;
  totalApprovedDurationMinutes: MetricValue;
  /** M5 起正式统计统一来自 Analytics Service；`M2_APPROVED_REPAIRS` 保留为历史兼容值。 */
  source: "M2_APPROVED_REPAIRS" | "M5_ANALYTICS";
  generatedAt: string;
};

export type MemberWorkQueue = {
  draftCount: number;
  pendingCount: number;
  rejectedCount: number;
};

/** M4/M5 尚未接入的中性占位。**禁止**为其编造业务数字。 */
export type DeferredModule = {
  available: false;
  module: "M4" | "M5";
};

/**
 * 工作台中允许独立降级的区块。
 *
 * 四路维修查询相互独立，某一路失败不应导致整页报错（任务书 §12.1
 * 「指标加载用稳定骨架，失败时局部错误」）。失败区块在 `MemberDashboard`
 * 里回退为空数组 / 空队列，并在此字段中列名，供客户端只对该区块渲染错误态。
 */
export type MemberDashboardDegraded =
  | "repairSummary"
  | "workQueue"
  | "recentRepairs"
  | "recentActivity"
  | "notifications"
  | "favorites"
  | "ranking";

export type MemberRef = { id: string; name: string };

export type NotificationView = {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  repairRecordId: string | null;
  /** 已废弃的兼容字段；评论退役后始终为 null。 */
  commentId: string | null;
  actor: MemberRef | null;
  repairExcerpt: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationListInput = PaginationInput & {
  status?: NotificationStatus;
};

export type NotificationListResult = {
  items: NotificationView[];
  unreadCount: number;
  pagination: PaginationMeta;
};

export type FavoriteView = {
  id: string;
  repairRecordId: string;
  repairDate: string | null;
  categoryName: string | null;
  contentExcerpt: string;
  memberName: string;
  isDifficult: boolean;
  isTypical: boolean;
  createdAt: string;
};

export type FavoriteListResult = {
  items: FavoriteView[];
  pagination: PaginationMeta;
};

/**
 * 通知摘要。
 *
 * `available: false` 表示**聚合这一项查询失败**（超时、连接不可用等），
 * 此时 `unreadCount` 必须是 `null` —— **不允许降级成 0**：
 * 「0 条未读」是一个真实的业务结论（确实没有），而「查不出来」是未知，
 * 两者在接口层面必须可分，否则调用方会把失败渲染成「没有新消息」。
 * 与 M3 的 `MetricValue`（宁可标 `UNAVAILABLE` 也不给 0）保持同一口径。
 *
 * `latest` 在失败时为空数组，仅作为结构占位；前端应据 `available` 渲染错误态，
 * 而不是把空数组渲染成「暂无通知」。
 */
export type MemberNotificationSummary =
  | { available: true; unreadCount: number; latest: NotificationView[] }
  | { available: false; unreadCount: null; latest: NotificationView[] };

/** 收藏摘要。失败语义同 {@link MemberNotificationSummary}：`available: false` 时 `count` 为 `null`，不给 0。 */
export type MemberFavoriteSummary =
  | { available: true; count: number; latest: FavoriteView[] }
  | { available: false; count: null; latest: FavoriteView[] };

/* ------------------------------------------------------------------ M5 统计 */

/**
 * 统计范围对应的 UTC 半开区间 `[startInclusive, endExclusive)`。
 * `MONTH` / `ACADEMIC_YEAR` 两端必有值；`ALL_TIME` 无日期条件，两端为 `null`。
 */
export type AnalyticsRange = {
  startInclusive: string | null;
  endExclusive: string | null;
  timezone: "Asia/Shanghai";
};

/** M5 个人正式统计摘要。四个指标字段的含义与 M3 完全一致，只换来源标注。 */
export type MemberAnalyticsSummary = MemberRepairSummary & {
  source: "M5_ANALYTICS";
};

/** 故障分类分布。无分类的历史记录归入稳定桶 `categoryId = null`，不因分类停用而改写。 */
export type CategoryDistributionItem = {
  categoryId: string | null;
  categoryName: string;
  approvedCount: number;
  durationMinutes: number;
};

/** 月度趋势点。`month` 为 `Asia/Shanghai` 自然月的 `YYYY-MM`，缺失月份由 Service 补真实 0。 */
export type MonthlyTrendPoint = {
  month: string;
  approvedCount: number;
  durationMinutes: number;
};

export type MemberAnalytics = {
  summary: MemberAnalyticsSummary;
  categoryDistribution: CategoryDistributionItem[];
  monthlyTrend: MonthlyTrendPoint[];
  generatedAt: string;
};

/**
 * 排行榜条目。
 * **禁止**加入 QQ、手机号、学号、班级或 `userId` —— 这是内部榜单 DTO 的上限。
 */
export type RankingEntry = {
  /** 竞赛排名语义：主指标相同则名次相同，后续名次跳号（10,10,8 → 1,1,3）。 */
  rank: number;
  memberProfileId: string;
  displayName: string;
  avatarUrl: string | null;
  approvedCount: number;
  durationMinutes: number;
  /** 当前主指标的值，等于 `approvedCount` 或 `durationMinutes`。 */
  metricValue: number;
  isCurrentMember: boolean;
};

export type RankingResult = {
  scope: AnalyticsScope;
  metric: RankingMetric;
  range: AnalyticsRange;
  items: RankingEntry[];
  /** 「我的排名」不受当前分页影响；零记录时为 `null`。 */
  currentMember: RankingEntry | null;
  pagination: PaginationMeta;
  generatedAt: string;
  source: "M5_ANALYTICS";
};

export type MemberRankingPreview =
  | {
      available: true;
      scope: "ACADEMIC_YEAR";
      metric: "REPAIR_COUNT";
      leaders: RankingEntry[];
      currentMember: RankingEntry | null;
      generatedAt: string;
    }
  | {
      available: false;
      scope: "ACADEMIC_YEAR";
      metric: "REPAIR_COUNT";
      leaders: RankingEntry[];
      currentMember: null;
      generatedAt: string;
    };

export const RANKING_PAGE_SIZE_DEFAULT = 20;
export const RANKING_PAGE_SIZE_MAX = 100;
/** 工作台预览只展示前三名。 */
export const RANKING_PREVIEW_LIMIT = 3;
/** 月度趋势固定 12 个月。 */
export const ANALYTICS_TREND_MONTHS = 12;
/** 无分类历史记录的稳定展示名，与 `categoryId = null` 桶对应。 */
export const UNCATEGORIZED_LABEL = "未分类";

export type RankingQueryInput = PaginationInput & {
  scope: AnalyticsScope;
  metric: RankingMetric;
};

export type MemberDashboard = {
  profile: MemberProfileSummary;
  repairSummary: MemberRepairSummary;
  workQueue: MemberWorkQueue;
  recentRepairs: MemberRecentRepair[];
  recentActivity: MemberRecentActivity[];
  /** 加载失败的区块清单；空数组表示全部成功。 */
  degraded: MemberDashboardDegraded[];
  notifications: MemberNotificationSummary;
  favorites: MemberFavoriteSummary;
  /** M5 起替换 M3 的 `DeferredModule` 占位，返回本学年维修数量榜预览。 */
  ranking: MemberRankingPreview;
};

/** 个人主页（自己）聚合视图：资料 + 技能 + 摘要 + 最近已通过记录。 */
export type MemberSelfProfileView = {
  profile: MemberSelfProfile;
  repairSummary: MemberRepairSummary;
  recentRepairs: MemberRecentRepair[];
};

/** 他人内部主页聚合视图。 */
export type MemberInternalProfileView = {
  profile: MemberInternalProfile;
  repairSummary: MemberRepairSummary;
  recentRepairs: MemberRecentRepair[];
};

export type UpdateMemberProfileInput = {
  nickname?: string | null;
  version: number;
};

export type UpdateMemberProfileResult = {
  profile: MemberSelfProfile;
  version: number;
};

export type UpdateMemberSkillsInput = {
  skillIds: string[];
  profileVersion: number;
};

export type UpdateMemberSkillsResult = {
  skills: SkillView[];
  version: number;
};

export const MEMBER_SKILL_LIMIT = 12;
export const MEMBER_NICKNAME_MAX_LENGTH = 64;
export const MEMBER_RECENT_REPAIR_LIMIT = 5;
export const MEMBER_DASHBOARD_NOTIFICATION_LIMIT = 5;
export const MEMBER_DASHBOARD_FAVORITE_LIMIT = 5;

export interface MemberProfileServiceContract {
  /** `now` 仅供测试注入固定时钟；生产一律使用默认值（当前时刻）。 */
  getSelf(actor: AuthorizedActor, now?: Date): Promise<MemberSelfProfileView>;
  getInternal(
    memberProfileId: string,
    actor: AuthorizedActor,
    now?: Date,
  ): Promise<MemberInternalProfileView>;
  updateProfile(
    input: UpdateMemberProfileInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberProfileResult>;
  updateSkills(
    input: UpdateMemberSkillsInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberSkillsResult>;
}

export interface SkillQueryServiceContract {
  listActive(): Promise<SkillView[]>;
}

export interface MemberDashboardServiceContract {
  getDashboard(actor: AuthorizedActor, now?: Date): Promise<MemberDashboard>;
}

export interface MemberAnalyticsServiceContract {
  /** 本人正式统计：累计/本月/学期/时长 + 分类分布 + 12 个月趋势。 */
  getMemberAnalytics(actor: AuthorizedActor, now?: Date): Promise<MemberAnalytics>;
  /**
   * 管理端指定成员统计（M6「查看成员统计」）。
   *
   * 与被上面的本人版本**口径完全一致**（同一 Repository 函数），唯一区别是
   * 允许显式传入 `memberProfileId`，因此必须单独校验 `analytics:read_internal`，
   * 且**不得**把本人版本改成接受 `memberProfileId` —— 那会让任何成员遍历他人统计。
   */
  getMemberAnalyticsFor(
    memberProfileId: string,
    actor: AuthorizedActor,
    now?: Date,
  ): Promise<MemberAnalytics>;
}

/** M6 成员管理（管理端）。与成员自助的 `MemberProfileServiceContract` 分开，避免权限串味。 */
export interface MemberServiceContract {
  create(input: CreateMemberInput, actor: AuthorizedActor): Promise<MemberMutationResult>;
  list(input: MemberListInput, actor: AuthorizedActor): Promise<MemberListResult>;
  getDetail(memberId: string, actor: AuthorizedActor): Promise<MemberDetail>;
  update(
    memberId: string,
    input: UpdateMemberInput,
    actor: AuthorizedActor,
  ): Promise<MemberUpdateView>;
  setEnabled(memberId: string, enabled: boolean, actor: AuthorizedActor): Promise<MemberView>;
  batchSetEnabled(
    input: MemberBatchToggleInput,
    actor: AuthorizedActor,
  ): Promise<MemberBatchToggleResult>;
  resetPassword(memberId: string, actor: AuthorizedActor): Promise<MemberMutationResult>;
  /**
   * 账号恢复：按 QQ 精确查询账号（成员或管理员，管理员可以没有成员档案）。
   * 只返回最小信息；`canReset=false` 时给出与登录资格一致的 `blockedReason`。
   */
  lookupAccount(
    input: AdminAccountLookupInput,
    actor: AuthorizedActor,
  ): Promise<AdminAccountLookupResult>;
  /**
   * 为目标账号签发临时密码：6 位安全随机数字、1 小时有效、强制改密、
   * 撤销全部旧 Session；拒绝自助恢复（`actor.userId` 即目标）与不可用账号。
   */
  resetAccountPassword(userId: string, actor: AuthorizedActor): Promise<AdminAccountResetResult>;
  /**
   * 拖动排序：把 `memberIds`（1..50 位，保持它们之间的原有先后）整体挪到 `beforeId` 之前
   * （`null` = 挪到末尾）。落在原位时幂等成功（返回 `false`，不写审计）；任一位成员不存在则 404。
   */
  move(memberIds: string[], beforeId: string | null, actor: AuthorizedActor): Promise<boolean>;
  setRoles(
    memberId: string,
    input: SetMemberRolesInput,
    actor: AuthorizedActor,
  ): Promise<MemberListEntry>;
  setSkills(
    memberId: string,
    input: UpdateMemberSkillsInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberSkillsResult>;
}

/** M6 维修管理（管理端审核之外的部分：改数据、软删除、批量审核）。 */
export interface RepairAdminServiceContract {
  updateFlags(
    recordId: string,
    input: RepairFlagsInput,
    actor: AuthorizedActor,
  ): Promise<RepairView>;
  updateRecord(
    recordId: string,
    input: RepairAdminUpdateInput,
    actor: AuthorizedActor,
  ): Promise<RepairView>;
  batchReview(
    input: RepairBatchReviewInput,
    actor: AuthorizedActor,
  ): Promise<RepairBatchReviewResult>;
}

/** M6 数据导出。 */
export interface RepairExportServiceContract {
  export(
    input: RepairExportInput,
    format: ExportFormat,
    actor: AuthorizedActor,
  ): Promise<RepairExportResult>;
}

export interface RankingServiceContract {
  getRankings(input: RankingQueryInput, actor: AuthorizedActor, now?: Date): Promise<RankingResult>;
  /**
   * 工作台排行预览：固定「本学年 + 维修数量」，取前 {@link RANKING_PREVIEW_LIMIT} 名。
   * 与完整榜单共用同一排名算法，不另写一套逻辑。
   *
   * 与 `getRankings` 一样**必须传 actor 并校验 `analytics:read_internal`** ——
   * 它接受显式 `memberProfileId`，若不校验权限就会成为一条绕过排行权限、
   * 直接读任意成员名次的旁路。
   */
  getYearPreview(
    memberProfileId: string,
    actor: AuthorizedActor,
    now?: Date,
  ): Promise<MemberRankingPreview>;
}

export interface JoinApplicationServiceContract {
  list(
    input: JoinApplicationListInput,
    actor: AuthorizedActor,
  ): Promise<TableListExtras & { items: JoinApplicationSummary[]; pagination: PaginationMeta }>;
  get(applicationId: string, actor: AuthorizedActor): Promise<JoinApplicationDetail>;
  /** 更正通知邮箱：按通知任务状态决定是否同步任务收件地址。 */
  correctNotificationEmail(
    applicationId: string,
    input: CorrectJoinNotificationEmailInput,
    actor: AuthorizedActor,
  ): Promise<JoinNotificationEmailCorrection>;
  softDelete(applicationId: string, actor: AuthorizedActor): Promise<void>;
  submit(input: SubmitJoinApplicationInput, context: PublicRequestContext): Promise<JoinReceipt>;
  review(input: ReviewJoinApplicationInput, actor: AuthorizedActor): Promise<JoinApplicationView>;
  retryProvision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView>;
  provision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView>;
}

export interface InviteCodeServiceContract {
  list(input: InviteCodeListInput, actor: AuthorizedActor): Promise<InviteCodeListResult>;
  create(input: CreateInviteCodeInput, actor: AuthorizedActor): Promise<CreateInviteCodeResult>;
  update(
    inviteCodeId: string,
    input: UpdateInviteCodeInput,
    actor: AuthorizedActor,
  ): Promise<InviteCodeView>;
  revoke(inviteCodeId: string, actor: AuthorizedActor): Promise<InviteCodeView>;
  redeem(
    input: RedeemInviteCodeInput,
    context: PublicRequestContext,
  ): Promise<MemberRegistrationResult>;
}

export interface SkillAdminServiceContract {
  /** 管理端列表：**含已停用**，并带当前生效的成员关联计数。 */
  list(actor: AuthorizedActor): Promise<SkillAdminView[]>;
  create(input: CreateSkillInput, actor: AuthorizedActor): Promise<SkillView>;
  update(skillId: string, input: UpdateSkillInput, actor: AuthorizedActor): Promise<SkillView>;
  /** 停用 / 启用。技能标签与故障分类同策略：不做物理删除。 */
  setActive(skillId: string, isActive: boolean, actor: AuthorizedActor): Promise<SkillView>;
  /** 上移 / 下移一格。列表顺序对成员侧的标签展示有意义，用按钮比让人填序号可靠。 */
  reorder(skillId: string, direction: ReorderDirection, actor: AuthorizedActor): Promise<void>;
  /**
   * 拖动排序：把 `skillId` 放到 `beforeId` 之前（`null` = 末尾）。
   * 拖动会跨越任意格数，因此一次算出最终顺序、一次写库；与 `reorder` 结果等价。
   */
  move(skillId: string, beforeId: string | null, actor: AuthorizedActor): Promise<void>;
}

export interface AuditLogServiceContract {
  list(input: AuditLogListInput, actor: AuthorizedActor): Promise<AuditLogListResult>;
  listActions(actor: AuthorizedActor): Promise<AuditActionOption[]>;
}

export interface PublicContentSettingsServiceContract {
  get(actor: AuthorizedActor): Promise<PublicContentSettings>;
  update(
    input: UpdatePublicContentSettingsInput,
    actor: AuthorizedActor,
  ): Promise<PublicContentSettings>;
}

export interface JoinApplicationExportServiceContract {
  export(
    input: JoinApplicationExportInput,
    format: ExportFormat,
    actor: AuthorizedActor,
  ): Promise<JoinApplicationExportResult>;
}

export interface AccountProvisionServiceContract {
  provisionFromApplication(applicationId: string, idempotencyKey: string): Promise<ProvisionResult>;
  provisionFromInvite(redemptionId: string, idempotencyKey: string): Promise<ProvisionResult>;
}

export interface RepairServiceContract {
  /** @deprecated 生产入口已下线，仅测试夹具使用。 */
  createDraft(input: CreateRepairDraftInput, actor: AuthorizedActor): Promise<RepairView>;
  /** 新建表单的「提交即建单」：直接创建 PENDING，不落草稿。 */
  createSubmitted(input: CreateSubmittedRepairInput, actor: AuthorizedActor): Promise<RepairView>;
  update(recordId: string, input: UpdateRepairInput, actor: AuthorizedActor): Promise<RepairView>;
  submit(recordId: string, input: SubmitRepairInput, actor: AuthorizedActor): Promise<RepairView>;
  softDelete(recordId: string, reason: string, actor: AuthorizedActor): Promise<void>;
}
export interface RepairReviewServiceContract {
  review(recordId: string, input: ReviewRepairInput, actor: AuthorizedActor): Promise<RepairView>;
}
export interface RepairQueryServiceContract {
  list(input: RepairListInput, actor: AuthorizedActor): Promise<RepairListResult>;
  getById(recordId: string, actor: AuthorizedActor): Promise<RepairDetailView>;
}

export interface RepairFavoriteServiceContract {
  list(input: PaginationInput, actor: AuthorizedActor): Promise<FavoriteListResult>;
  add(repairRecordId: string, actor: AuthorizedActor): Promise<FavoriteView>;
  remove(repairRecordId: string, actor: AuthorizedActor): Promise<void>;
}

// ---------------------------------------------------------------------------
// 邮箱身份与验证基础设施
// ---------------------------------------------------------------------------

/**
 * 邮箱验证码用途。四种用途严格隔离：验证码的 HMAC 摘要上下文
 * 绑定用途，一种用途的验证码不能被另一种用途消费（`不得混用`）。
 *
 * - `EMAIL_BIND`：为当前账号绑定一个新邮箱（目标 = 调用方提交的新邮箱）；
 * - `EMAIL_CHANGE_OLD`：换绑前验证**原邮箱**（目标由服务端按当前有效邮箱解析）；
 * - `EMAIL_CHANGE_NEW`：换绑验证**新邮箱**（目标 = 调用方提交的新邮箱）；
 * - `PASSWORD_RESET`：邮箱找回密码（目标由服务端解析），只能兑换为一次性重置授权。
 */
export const EmailChallengePurpose = [
  "EMAIL_BIND",
  "EMAIL_CHANGE_OLD",
  "EMAIL_CHANGE_NEW",
  "PASSWORD_RESET",
] as const;
export type EmailChallengePurpose = ValueOf<typeof EmailChallengePurpose>;

/** 发放验证码挑战的入参。`EMAIL_BIND` / `EMAIL_CHANGE_NEW` 必须给 `targetEmail`；
 *  其余用途的收件地址由服务端按当前有效已验证邮箱解析，不接受调用方指定。 */
export type RequestEmailChallengeInput = {
  userId: string;
  purpose: EmailChallengePurpose;
  targetEmail?: string;
};

/**
 * 发放结果（只给 UI 需要的字段）：验证码明文不返回给调用方（它只经邮件送达），
 * 邮箱回显**脱敏值**，完整地址不回传。`expiresAt` 为上海时区无关的 UTC ISO 时刻。
 */
export type EmailChallengeRequestResult = {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
};

/** 校验验证码的入参。`code` 只作为一次性输入使用，不落库、不进日志。 */
export type VerifyEmailChallengeInput = {
  challengeId: string;
  code: string;
  /**
   * 服务端调用方的用途 / 目标约束（可选）：不符即拒绝，且**不计入**用户失败次数
   * （用途不符是流量链路用错原语，不是用户在猜验证码）。
   */
  expectedUserId?: string;
  expectedPurpose?: EmailChallengePurpose;
  expectedEmailNormalized?: string;
};

/**
 * 校验成功的证明。**不是**登录凭据、不能跨用途使用：
 * 调用方拿到它后仍必须在自己的事务里用 `consumeEmailChallenge` 原语做
 * 「条件消费」—— 同一挑战并发下最多一份有效证明。
 */
export type EmailChallengeProof = {
  challengeId: string;
  userId: string;
  purpose: EmailChallengePurpose;
  emailNormalized: string;
};

/** 重置授权签发结果。`token` 明文**只在本返回值里出现一次**，库里只存摘要。 */
export type IssuePasswordResetAuthorizationResult = {
  grantId: string;
  userId: string;
  token: string;
  expiresAt: string;
};

/** 重置授权消费证明（事务内原语返回）。后续阶段据此在同一事务里写新密码、
 *  递增凭据代次并撤销全部 Session / 其他授权。 */
export type PasswordResetAuthorizationProof = {
  grantId: string;
  userId: string;
  emailIdentityId: string;
  emailNormalized: string;
  /** 签发时快照的凭据代次；消费时与当前值一致才放行（管理员重置后旧授权自动失效）。 */
  credentialVersion: number | null;
};

/**
 * 邮箱验证码挑战服务（服务端基础设施；主动绑定 HTTP 由 AccountEmailService 编排）。
 *
 * 事务内条件消费原语不在此接口上：它需要调用方的 Prisma 事务，
 * 由 `src/features/email/email-challenge-service.ts` 的 `consumeEmailChallenge` 导出。
 */
export interface EmailChallengeServiceContract {
  requestEmailChallenge(
    input: RequestEmailChallengeInput,
    context: PublicRequestContext,
    /** 仅服务端可信调用：未证明本人的匿名发起不记为 USER 操作。 */
    options?: { anonymous?: boolean },
  ): Promise<EmailChallengeRequestResult>;
  verifyEmailChallenge(
    input: VerifyEmailChallengeInput,
    context: PublicRequestContext,
  ): Promise<EmailChallengeProof>;
}

/**
 * 密码重置授权服务（服务端基础设施，HTTP 找回端点属后续阶段）。
 * 消费原语 `consumePasswordResetAuthorization` 同样在 Feature 模块导出（需调用方事务）。
 */
export interface PasswordResetServiceContract {
  verifyChallengeAndIssue(
    input: VerifyEmailChallengeInput,
    context: PublicRequestContext,
  ): Promise<IssuePasswordResetAuthorizationResult>;
}

export interface NotificationServiceContract {
  list(input: NotificationListInput, actor: AuthorizedActor): Promise<NotificationListResult>;
  markRead(notificationId: string, actor: AuthorizedActor): Promise<NotificationView>;
  markAllRead(actor: AuthorizedActor): Promise<{ updatedCount: number }>;
  softDelete(notificationId: string, actor: AuthorizedActor): Promise<void>;
}

// 邮箱主动管理；token 仅供服务端 Cookie 交付。
export type EmailCodeInput = { challengeId: string; code: string };
export type AccountEmailChallengeInput =
  | { mode: "BIND"; targetEmail: string }
  | { mode: "OLD"; currentPassword: string }
  | { mode: "NEW"; targetEmail: string; currentPassword: string; old: EmailCodeInput }
  | { mode: "ASSISTED"; assistanceId: string; currentPassword: string };
export type AccountEmailConfirmInput =
  | { mode: "BIND"; targetEmail: string; proof: EmailCodeInput; returnTo?: string }
  | {
      mode: "CHANGE";
      targetEmail: string;
      currentPassword: string;
      old: EmailCodeInput;
      proof: EmailCodeInput;
      returnTo?: string;
    }
  | {
      mode: "ASSISTED";
      assistanceId: string;
      currentPassword: string;
      proof: EmailCodeInput;
      returnTo?: string;
    };
export type EmailExemptionView = { id: string; reason: string; expiresAt: string };
export type EmailAssistanceView = { id: string; targetEmail: string; expiresAt: string };
export type EmailVerificationState = { verified: boolean; exemption: EmailExemptionView | null };
export type AccountEmailState = EmailVerificationState & {
  email: string | null;
  mailEnabled: boolean;
  assistance: EmailAssistanceView | null;
};
export type AdminAccountEmailState = EmailVerificationState & {
  maskedEmail: string | null;
  assistance: EmailAssistanceView | null;
  canAssist: boolean;
  canExempt: boolean;
  mustChangePassword: boolean;
};
export interface AccountEmailServiceContract {
  getState(token: string): Promise<AccountEmailState>;
  requestChallenge(
    token: string,
    input: AccountEmailChallengeInput,
    context: PublicRequestContext,
  ): Promise<EmailChallengeRequestResult>;
  confirm(
    token: string,
    input: AccountEmailConfirmInput,
    context: PublicRequestContext,
  ): Promise<{ token: string; expiresAt: string; destination: string }>;
}
export interface AdminAccountEmailServiceContract {
  getAdminState(userId: string, actor: AuthorizedActor): Promise<AdminAccountEmailState>;
  reveal(
    userId: string,
    actor: AuthorizedActor,
  ): Promise<{ email: string | null; targetEmail: string | null }>;
  createAssistance(
    userId: string,
    input: { targetEmail: string; reason: string },
    actor: AuthorizedActor,
  ): Promise<void>;
  revokeAssistance(userId: string, id: string, actor: AuthorizedActor): Promise<void>;
  grantExemption(
    userId: string,
    input: { reason: string; durationHours?: number },
    actor: AuthorizedActor,
  ): Promise<void>;
  revokeExemption(userId: string, id: string, actor: AuthorizedActor): Promise<void>;
}

// 匿名邮箱找回。授权 token 只供服务端设置专用 Cookie。
export type PasswordRecoveryRequestInput = { qq: string };
export type PasswordRecoveryRequestResult = {
  challengeId: string;
  expiresAt: string;
  message: string;
};
export type PasswordRecoveryConfirmInput = { newPassword: string; newPasswordConfirmation: string };
/** HTTP 验码结果；内部授权由 HttpOnly Cookie 交付，不属于 JSON DTO。 */
export type PasswordRecoveryVerifyResult = { authorized: true; expiresAt: string };
export type PasswordRecoveryConfirmResult = { changed: true; destination: "/login" };
export interface PasswordRecoveryServiceContract {
  request(
    input: PasswordRecoveryRequestInput,
    context: PublicRequestContext,
  ): Promise<PasswordRecoveryRequestResult>;
  verify(
    input: EmailCodeInput,
    context: PublicRequestContext,
  ): Promise<{ token: string; expiresAt: string }>;
  confirm(
    token: string,
    input: PasswordRecoveryConfirmInput,
    context: PublicRequestContext,
  ): Promise<PasswordRecoveryConfirmResult>;
}

/** 报名详情中的通知状态，不返回地址、领取标识或凭据。 */
export type AccountNotificationStatus = "PENDING" | "SENDING" | "ACCEPTED" | "FAILED" | "UNCERTAIN";
export type AccountNotificationView = {
  status: AccountNotificationStatus;
  attemptCount: number;
  roundAttemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  acceptedAt: string | null;
  messageId: string | null;
  canRetry: boolean;
};
export type AccountNotificationBatchResult = {
  claimed: number;
  accepted: number;
  failed: number;
  uncertain: number;
  pending: number;
  disabled: boolean;
};
export interface AccountNotificationServiceContract {
  get(applicationId: string, actor: AuthorizedActor): Promise<AccountNotificationView | null>;
  retry(applicationId: string, actor: AuthorizedActor): Promise<AccountNotificationView>;
  runBatch(input?: { limit?: number }): Promise<AccountNotificationBatchResult>;
}
