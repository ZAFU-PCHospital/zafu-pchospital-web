import { randomBytes, randomUUID } from "node:crypto";

import {
  ensureMemberProfile,
  grantMemberRole,
  resolveOrCreateUser,
  setInitialPassword,
} from "@/features/accounts/account-repository";
import { movedRowIds } from "@/features/admin/reorder";
import { memberRepository } from "@/features/members/member-repository";
import { saveMemberSkills } from "@/features/member-profile/member-profile-service";
import { skillRepository } from "@/features/skills/skill-repository";
import { toSkillView } from "@/features/skills/skill-service";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { normalizePhone, normalizeQq } from "@/lib/security/normalization";
import { hashPassword } from "@/lib/security/secrets";
import {
  ADMIN_BATCH_LIMIT,
  MEMBER_NICKNAME_MAX_LENGTH,
  type AuthorizedActor,
  type CreateMemberInput,
  type MemberBatchToggleInput,
  type MemberBatchToggleResult,
  type MemberDetail,
  type MemberListEntry,
  type MemberListInput,
  type MemberListResult,
  type MemberMutationResult,
  type MemberServiceContract,
  type MemberView,
  type RoleCode,
  type SetMemberRolesInput,
  type UpdateMemberInput,
  type UpdateMemberSkillsInput,
  type UpdateMemberSkillsResult,
} from "@/types/contracts";

/**
 * 成员服务（M1 发放/禁用/重置 + M6 管理端）。
 *
 * 权限一律 `member:manage`（ADMIN 独占）。管理端新增的四类读取/写入都遵循同一条规则：
 * 走 Service、写审计、乐观锁，绝不绕过既有状态规则直接改库。
 */
export class MemberService implements MemberServiceContract {
  async create(input: CreateMemberInput, actor: AuthorizedActor): Promise<MemberMutationResult> {
    requirePermission(actor, "member:manage");
    if (
      input.realName.trim().length < 2 ||
      input.realName.trim().length > 64 ||
      !input.idempotencyKey.trim()
    ) {
      throw new AppError("VALIDATION_FAILED", "成员姓名或幂等键无效");
    }
    const replay = await getDb().accountProvision.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      if (replay.sourceType !== "ADMIN_CREATED" || !replay.memberProfileId)
        throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已被其他请求使用");
      const profile = await getDb().memberProfile.findUniqueOrThrow({
        where: { id: replay.memberProfileId },
        include: { user: { include: { identities: { where: { deletedAt: null } } } } },
      });
      const sameQq = profile.user.identities.some(
        (identity) =>
          identity.type === "QQ" && identity.identifierNormalized === normalizeQq(input.qq),
      );
      const samePhone = profile.user.identities.some(
        (identity) =>
          identity.type === "PHONE" &&
          identity.identifierNormalized === normalizePhone(input.phone),
      );
      if (!sameQq || !samePhone || profile.realName !== input.realName.trim()) {
        throw new AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一项成员创建请求");
      }
      return { member: await this.getView(replay.memberProfileId) };
    }
    const secret = randomBytes(18).toString("base64url");
    const member = await inSerializableTransaction(async (tx) => {
      const sourceId = randomUUID();
      const userId = await resolveOrCreateUser(
        tx,
        { qq: normalizeQq(input.qq), phone: normalizePhone(input.phone) },
        input.realName.trim(),
      );
      /* 这个 QQ / 手机号已经属于某位成员时**拒绝创建**，不要往下走。
         `ensureMemberProfile` 会复用已有档案并覆盖 `realName` / `studentId` / `className`，
         已有密码时 `setInitialPassword` 又返回 false（不发初始密码）—— 于是管理员填错一位数字，
         看到的是「创建成功」，实际把**另一位成员**的姓名与学号改掉了（浏览器实测：
         用同一个 QQ 连续创建两次 → 第二次 201 且响应里没有初始密码）。
         需求要的是「新增成员」，不是「按 QQ 覆盖资料」；要改资料请走成员详情的编辑。 */
      const occupied = await tx.memberProfile.findUnique({
        where: { userId },
        select: { realName: true, deletedAt: true },
      });
      if (occupied) {
        throw new AppError(
          "ACCOUNT_IDENTITY_CONFLICT",
          `该 QQ / 手机号已属于成员「${occupied.realName}」，请勿重复创建；如需修改资料请打开该成员的详情。`,
        );
      }
      const memberProfileId = await ensureMemberProfile(tx, {
        userId,
        realName: input.realName.trim(),
        studentId: clean(input.studentId),
        className: clean(input.className),
      });
      if (input.nickname !== undefined)
        await tx.memberProfile.update({
          where: { id: memberProfileId },
          data: { nickname: clean(input.nickname) },
        });
      await grantMemberRole(tx, {
        userId,
        sourceType: "ADMIN_CREATED",
        sourceId,
        grantedBy: actor.userId,
      });
      const passwordCreated = await setInitialPassword(tx, userId, secret);
      await tx.accountProvision.create({
        data: {
          id: randomUUID(),
          sourceType: "ADMIN_CREATED",
          sourceId,
          idempotencyKey: input.idempotencyKey,
          status: "SUCCEEDED",
          userId,
          memberProfileId,
          attemptCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.created",
        targetType: "MemberProfile",
        targetId: memberProfileId,
        result: "SUCCESS",
        after: { userId, realName: input.realName, qq: input.qq, phone: input.phone },
      });
      return { memberProfileId, passwordCreated };
    });
    return {
      member: await this.getView(member.memberProfileId),
      ...(member.passwordCreated ? { initializationSecret: secret } : {}),
    };
  }

  /** M6 `GET /api/v1/admin/members` —— 分页 + 关键字 + 状态/角色筛选，联系方式一律脱敏。 */
  async list(input: MemberListInput, actor: AuthorizedActor): Promise<MemberListResult> {
    requirePermission(actor, "member:manage");
    const { rows, total } = await memberRepository.list(input);
    return {
      items: rows,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize),
      },
    };
  }

  /**
   * M6 成员详情：管理端唯一返回 QQ / 手机号明文的位置。
   * 读明文属于「查看敏感信息」，因此**同一次事务内必写审计**，不存在只看不留痕的路径。
   */
  async getDetail(memberId: string, actor: AuthorizedActor): Promise<MemberDetail> {
    requirePermission(actor, "member:manage");
    return inSerializableTransaction(async (tx) => {
      const entry = await memberRepository.findById(memberId);
      if (!entry) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
      const contacts = await memberRepository.findSensitiveContacts(memberId);
      const skillRows = await skillRepository.listMemberSkills(memberId);
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.detail.viewed",
        targetType: "MemberProfile",
        targetId: memberId,
        result: "SUCCESS",
        // 明文不进审计：redaction 会把 qq / phone 自动脱敏（见 lib/audit/redaction.ts）。
        after: { qq: contacts.qq, phone: contacts.phone },
      });
      return { ...entry, ...contacts, skills: skillRows.map(toSkillView) };
    });
  }

  /**
   * M6 编辑成员：实名 / 学号 / 班级 / 昵称。
   *
   * 与成员自助改昵称一样走乐观锁；被 `member:manage` 保护，且写审计（M3 交付报告里
   * 明确把「实名、学号、班级的管理端编辑接口」留给 M6）。
   */
  async update(
    memberId: string,
    input: UpdateMemberInput,
    actor: AuthorizedActor,
  ): Promise<MemberView> {
    requirePermission(actor, "member:manage");
    if (!Number.isInteger(input.version) || input.version < 1)
      throw new AppError("VALIDATION_FAILED", "version 必须是正整数", {
        fieldErrors: { version: ["version 必须是正整数"] },
      });
    const realName = input.realName?.trim();
    if (realName !== undefined && (realName.length < 2 || realName.length > 64))
      throw new AppError("VALIDATION_FAILED", "姓名长度必须为 2–64 个字符", {
        fieldErrors: { realName: ["姓名长度必须为 2–64 个字符"] },
      });
    if (input.studentId !== undefined && (input.studentId?.trim() ?? "").length > 32)
      throw new AppError("VALIDATION_FAILED", "学号不能超过 32 个字符", {
        fieldErrors: { studentId: ["学号不能超过 32 个字符"] },
      });
    if (input.className !== undefined && (input.className?.trim() ?? "").length > 80)
      throw new AppError("VALIDATION_FAILED", "班级不能超过 80 个字符", {
        fieldErrors: { className: ["班级不能超过 80 个字符"] },
      });
    if (
      input.nickname !== undefined &&
      (input.nickname?.trim() ?? "").length > MEMBER_NICKNAME_MAX_LENGTH
    )
      throw new AppError(
        "MEMBER_PROFILE_INVALID_NICKNAME",
        `昵称不能超过 ${MEMBER_NICKNAME_MAX_LENGTH} 个字符`,
      );

    await inSerializableTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${memberId} FOR UPDATE`;
      const before = await tx.memberProfile.findFirst({
        where: { id: memberId, deletedAt: null },
      });
      if (!before) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
      if (before.version !== input.version)
        throw new AppError("MEMBER_PROFILE_VERSION_CONFLICT", "成员资料已被更新，请刷新后重试");
      const updated = await tx.memberProfile.updateMany({
        where: { id: memberId, version: input.version, deletedAt: null },
        data: {
          realName,
          studentId: input.studentId === undefined ? undefined : input.studentId?.trim() || null,
          className: input.className === undefined ? undefined : input.className?.trim() || null,
          nickname: input.nickname === undefined ? undefined : input.nickname?.trim() || null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new AppError("MEMBER_PROFILE_VERSION_CONFLICT", "成员资料已被更新，请刷新后重试");
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.profile.updated",
        targetType: "MemberProfile",
        targetId: memberId,
        result: "SUCCESS",
        before: {
          realName: before.realName,
          studentId: before.studentId,
          className: before.className,
          nickname: before.nickname,
        },
        after: {
          realName: realName ?? before.realName,
          studentId: input.studentId === undefined ? before.studentId : input.studentId,
          className: input.className === undefined ? before.className : input.className,
          nickname: input.nickname === undefined ? before.nickname : input.nickname,
        },
      });
    });
    return this.getView(memberId);
  }

  async setEnabled(
    memberId: string,
    enabled: boolean,
    actor: AuthorizedActor,
  ): Promise<MemberView> {
    requirePermission(actor, "member:manage");
    await inSerializableTransaction(async (tx) => {
      const profile = await tx.memberProfile.findUnique({ where: { id: memberId } });
      if (!profile || profile.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
      // 自锁保护：禁用自己的成员资格会立刻丢掉成员视角的页面访问，
      // 而「禁用」语义只撤成员资格、不动 ADMIN 角色，结果是一个说不清的中间态。
      if (!enabled && profile.userId === actor.userId)
        throw new AppError("MEMBER_SELF_LOCKOUT", "不能禁用自己的账号");
      const memberRole = await tx.role.findUniqueOrThrow({ where: { code: "MEMBER" } });
      if (enabled) {
        await tx.user.update({ where: { id: profile.userId }, data: { status: "ACTIVE" } });
        await tx.memberProfile.update({ where: { id: memberId }, data: { status: "ACTIVE" } });
        await grantMemberRole(tx, {
          userId: profile.userId,
          sourceType: "ADMIN_CREATED",
          sourceId: memberId,
          grantedBy: actor.userId,
        });
      } else {
        await tx.memberProfile.update({ where: { id: memberId }, data: { status: "REVOKED" } });
        await tx.userRole.updateMany({
          where: { userId: profile.userId, roleId: memberRole.id, revokedAt: null },
          data: { revokedAt: new Date(), activeKey: null },
        });
        await tx.authSession.updateMany({
          where: { userId: profile.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await appendAuditLog(tx, {
          actor,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "auth.session.revoked",
          targetType: "User",
          targetId: profile.userId,
          result: "SUCCESS",
        });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: enabled ? "member.enabled" : "member.disabled",
        targetType: "MemberProfile",
        targetId: memberId,
        result: "SUCCESS",
        after: { status: enabled ? "ACTIVE" : "REVOKED" },
      });
    });
    return this.getView(memberId);
  }

  /**
   * M6 批量禁用 / 启用。
   *
   * 逐条调用 `setEnabled`，因此**每条都走完整的状态规则与单条审计**，不做绕过 Service 的
   * 批量 UPDATE。允许部分成功：返回逐条结果，界面必须逐条展示失败原因。
   */
  async batchSetEnabled(
    input: MemberBatchToggleInput,
    actor: AuthorizedActor,
  ): Promise<MemberBatchToggleResult> {
    requirePermission(actor, "member:manage");
    const memberIds = [...new Set(input.memberIds.map((id) => id.trim()).filter(Boolean))];
    if (memberIds.length === 0)
      throw new AppError("VALIDATION_FAILED", "批量操作至少需要选择一名成员");
    if (memberIds.length > ADMIN_BATCH_LIMIT)
      throw new AppError(
        "MEMBER_BATCH_LIMIT_EXCEEDED",
        `单次批量最多 ${ADMIN_BATCH_LIMIT} 名成员，请分批执行`,
      );

    const succeeded: string[] = [];
    const failed: MemberBatchToggleResult["failed"] = [];
    for (const memberId of memberIds) {
      try {
        await this.setEnabled(memberId, input.enabled, actor);
        succeeded.push(memberId);
      } catch (error) {
        const appError =
          error instanceof AppError
            ? error
            : new AppError("INTERNAL_ERROR", "服务暂时不可用，请稍后重试");
        failed.push({ memberId, code: appError.code, message: appError.message });
      }
    }
    await inSerializableTransaction(async (tx) => {
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.batch.toggled",
        targetType: "MemberProfile",
        // 批量没有单一目标：用操作者之外的稳定占位会误导查询，因此这里记全部目标，
        // targetId 取第一个成员以便按目标检索时仍能命中（完整清单在 after 里）。
        targetId: memberIds[0]!,
        result: failed.length === 0 ? "SUCCESS" : "FAILURE",
        after: {
          enabled: input.enabled,
          requested: memberIds,
          succeeded,
          failed: failed.map((item) => `${item.memberId}:${item.code}`),
        },
      });
    });
    return { succeeded, failed };
  }

  async resetPassword(memberId: string, actor: AuthorizedActor): Promise<MemberMutationResult> {
    requirePermission(actor, "member:manage");
    const secret = randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(secret);
    await inSerializableTransaction(async (tx) => {
      const profile = await tx.memberProfile.findUnique({ where: { id: memberId } });
      if (!profile || profile.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
      await tx.passwordCredential.upsert({
        where: { userId: profile.userId },
        create: {
          userId: profile.userId,
          passwordHash,
          mustChangePassword: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        update: { passwordHash, mustChangePassword: true, passwordChangedAt: null },
      });
      await tx.authSession.updateMany({
        where: { userId: profile.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "auth.password.reset",
        targetType: "MemberProfile",
        targetId: memberId,
        result: "SUCCESS",
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "auth.session.revoked",
        targetType: "User",
        targetId: profile.userId,
        result: "SUCCESS",
      });
    });
    return { member: await this.getView(memberId), initializationSecret: secret };
  }

  /**
   * M6 设置角色（`MEMBER` / `ADMIN` 的全量集合，不是增量）。
   *
   * 两条硬闸门：
   * 1. 集合必须非空且只含已有角色码；
   * 2. **不允许撤销最后一个在册管理员** —— 否则后台会把自己锁死，且没有任何界面可以恢复。
   *
   * 角色变化不需要撤销会话：`authenticateRequest` 每次请求都从数据库重算权限
   * （`authService.readPrincipal`），下一次请求即生效。
   */
  /**
   * 拖动排序：把某位成员挪到 `beforeId` 之前（`null` = 挪到末尾）。
   *
   * 为什么值得做：列表顺序是**用的人**才清楚的事 —— 谁该排在最前面（新生、值日表、
   * 待办重点）。写死「加入时间倒序」时管理员拖不动任何一行，界面上的手柄就是个摆设。
   *
   * 三条实现约定：
   * 1. **一次拖动写一次库**：拖动可能跨越几十行，用「上移一格」接口模拟要发 N 次请求、
   *    写 N 条审计（与 `skillAdminService.move` 同一套 `movedIds` 算法）。
   * 2. **写成稠密序号 `0..n-1`**：历史数据里可能有重复序号（新建成员默认 `sortOrder = 0`），
   *    只交换两行的序号在重复值下会「看起来没反应」。整份重排一次就自愈。
   * 3. **落在原位幂等成功**：不写库、不写审计 —— 用户松手在原来的位置不该收到一条错误。
   */
  async move(
    memberIds: string[],
    beforeId: string | null,
    actor: AuthorizedActor,
  ): Promise<boolean> {
    requirePermission(actor, "member:manage");
    // 选中集合去重后判断：同一行勾选两次不该变成两次移动。
    const moving = [...new Set(memberIds)];
    if (moving.length === 0 || moving.length > ADMIN_BATCH_LIMIT)
      throw new AppError("VALIDATION_FAILED", `一次最多移动 ${ADMIN_BATCH_LIMIT} 位成员`);
    return inSerializableTransaction(async (tx) => {
      const ids = await memberRepository.orderedIds(tx);
      const order = movedRowIds(ids, moving, beforeId, "RESOURCE_NOT_FOUND", "成员不存在");
      if (!order) return false; // 落点没变：幂等成功，不写审计
      // 整份写成稠密序号（不做「位置没变就跳过」的优化）：新建成员的 `sortOrder` 默认是 0，
      // 与已有行重复，跳过写的那些行会留下重复值，顺序就得靠兜底规则去猜。
      for (const [position, id] of order.entries()) {
        await tx.memberProfile.update({ where: { id }, data: { sortOrder: position } });
      }
      // 一次拖动**只写一条审计**（哪怕移动了 12 行）：审计要回答「谁在什么时候把哪几行
      // 挪到了哪儿」，逐行写 12 条反而看不出这是一次操作。
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.moved",
        targetType: "MemberProfile",
        targetId: moving[0],
        result: "SUCCESS",
        after: { beforeId, memberIds: moving },
      });
      return true;
    });
  }

  async setRoles(
    memberId: string,
    input: SetMemberRolesInput,
    actor: AuthorizedActor,
  ): Promise<MemberListEntry> {
    requirePermission(actor, "member:manage");
    const roles = [...new Set(input.roles)];
    if (roles.length === 0 || roles.some((role) => role !== "MEMBER" && role !== "ADMIN"))
      throw new AppError("MEMBER_ROLE_INVALID", "角色集合无效");
    await inSerializableTransaction(async (tx) => {
      const profile = await tx.memberProfile.findFirst({
        where: { id: memberId, deletedAt: null },
        select: { userId: true },
      });
      if (!profile) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
      const roleRows = await tx.role.findMany({
        where: { code: { in: roles } },
        select: { id: true, code: true },
      });
      if (roleRows.length !== roles.length)
        throw new AppError("MEMBER_ROLE_INVALID", "存在无法识别的角色");
      const current = await tx.userRole.findMany({
        where: { userId: profile.userId, revokedAt: null },
        select: { roleId: true, role: { select: { code: true } } },
      });
      const currentCodes = new Set(current.map((row) => row.role.code));
      const removingAdmin = currentCodes.has("ADMIN") && !roles.includes("ADMIN");
      if (removingAdmin) {
        const activeAdmins = await tx.userRole.count({
          where: {
            revokedAt: null,
            role: { code: "ADMIN" },
            user: { status: "ACTIVE", deletedAt: null },
          },
        });
        if (activeAdmins <= 1)
          throw new AppError(
            "MEMBER_LAST_ADMIN",
            "这是最后一个在册管理员，撤销后无人能进入管理后台",
          );
      }
      for (const row of current) {
        const code = row.role.code as RoleCode;
        if (roles.includes(code)) continue;
        await tx.userRole.updateMany({
          where: { userId: profile.userId, roleId: row.roleId, revokedAt: null },
          data: { revokedAt: new Date(), activeKey: null },
        });
      }
      for (const role of roleRows) {
        if (currentCodes.has(role.code as RoleCode)) continue;
        const activeKey = `${profile.userId}:${role.id}`;
        await tx.userRole.upsert({
          where: { activeKey },
          update: { revokedAt: null },
          create: {
            id: randomUUID(),
            userId: profile.userId,
            roleId: role.id,
            sourceType: "ADMIN_CREATED",
            grantedBy: actor.userId,
            grantedAt: new Date(),
            activeKey,
          },
        });
      }
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.roles.changed",
        targetType: "MemberProfile",
        targetId: memberId,
        result: "SUCCESS",
        before: { roles: [...currentCodes].sort() },
        after: { roles: [...roles].sort() },
      });
    });
    const entry = await memberRepository.findById(memberId);
    if (!entry) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
    return entry;
  }

  /**
   * 管理端前置校验：`member:manage` + 成员存在（未软删除）。
   *
   * 只验证「这个人能不能被当前操作者管理」，不读取任何敏感字段，因此**不需要审计** ——
   * 审计只挂在真正读到 QQ / 手机号明文的 `getDetail` 上。
   */
  async assertManageable(memberId: string, actor: AuthorizedActor): Promise<void> {
    requirePermission(actor, "member:manage");
    const profile = await getDb().memberProfile.findFirst({
      where: { id: memberId, deletedAt: null },
      select: { id: true },
    });
    if (!profile) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
  }

  /**
   * M6 管理员为成员设置技能标签。
   *
   * 复用 `saveMemberSkills`（与成员自助完全同一份实现），只把「目标是谁」与权限换成管理端版本。
   */
  async setSkills(
    memberId: string,
    input: UpdateMemberSkillsInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberSkillsResult> {
    await this.assertManageable(memberId, actor);
    return saveMemberSkills({ id: memberId }, input, actor, "MEMBER_SKILLS_UPDATED");
  }

  private async getView(memberId: string): Promise<MemberView> {
    const profile = await getDb().memberProfile.findUnique({ where: { id: memberId } });
    if (!profile || profile.deletedAt) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
    return {
      id: profile.id,
      userId: profile.userId,
      realName: profile.realName,
      nickname: profile.nickname,
      studentId: profile.studentId,
      className: profile.className,
      status: profile.status as MemberView["status"],
    };
  }
}

function clean(value?: string): string | undefined {
  return value?.trim() || undefined;
}
export const memberService = new MemberService();
