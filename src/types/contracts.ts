/** Phase 2 public contract constants. Database values and API inputs must use these constants. */
export const UserStatus = ["ACTIVE", "DISABLED"] as const;
export const RoleCode = ["MEMBER", "ADMIN"] as const;
export const MemberStatus = ["ACTIVE", "REVOKED"] as const;
export const IdentityType = ["PHONE", "QQ", "QQ_OAUTH", "WECHAT_OAUTH"] as const;
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

type ValueOf<T extends readonly string[]> = T[number];

export type UserStatus = ValueOf<typeof UserStatus>;
export type RoleCode = ValueOf<typeof RoleCode>;
export type MemberStatus = ValueOf<typeof MemberStatus>;
export type IdentityType = ValueOf<typeof IdentityType>;
export type JoinApplicationStatus = ValueOf<typeof JoinApplicationStatus>;
export type InterviewResult = ValueOf<typeof InterviewResult>;
export type ProvisionStatus = ValueOf<typeof ProvisionStatus>;
export type ProvisionSourceType = ValueOf<typeof ProvisionSourceType>;
export type InviteCodeStoredStatus = ValueOf<typeof InviteCodeStoredStatus>;
export type InviteCodeEffectiveStatus = ValueOf<typeof InviteCodeEffectiveStatus>;
export type AuditActorType = ValueOf<typeof AuditActorType>;

export const Permission = [
  "join:submit",
  "join:read",
  "join:review",
  "member:provision",
  "invite:create",
  "invite:read",
  "invite:revoke",
  "invite:redeem",
  "audit:read",
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
};

export type PaginationInput = { page: number; pageSize: number };
export type PaginationMeta = PaginationInput & {
  total: number;
  totalPages: number;
};

export type SubmitJoinApplicationInput = {
  recruitmentCycle: string;
  realName: string;
  qq: string;
  phone: string;
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
  interviewedAt: string;
  internalNote?: string;
  idempotencyKey: string;
};

export type JoinApplicationView = {
  id: string;
  status: JoinApplicationStatus;
  provisionStatus: ProvisionStatus;
  lastReviewedAt: string | null;
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
  studentId?: string;
  className?: string;
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

export interface JoinApplicationServiceContract {
  submit(input: SubmitJoinApplicationInput, context: PublicRequestContext): Promise<JoinReceipt>;
  review(input: ReviewJoinApplicationInput, actor: AuthorizedActor): Promise<JoinApplicationView>;
  retryProvision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView>;
}

export interface InviteCodeServiceContract {
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

export interface AccountProvisionServiceContract {
  provisionFromApplication(applicationId: string, idempotencyKey: string): Promise<ProvisionResult>;
  provisionFromInvite(redemptionId: string, idempotencyKey: string): Promise<ProvisionResult>;
}
