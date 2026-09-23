import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { maskPhone, maskQq } from "@/lib/audit/redaction";
import type { MemberListEntry, MemberListInput, RoleCode } from "@/types/contracts";

/**
 * 成员管理端数据访问（M6）。
 *
 * 与 `member-profile-repository.ts` 的分工：那个只服务「我自己的资料」，
 * 这个服务管理端的跨成员查询与写入。两者都不做权限判断 —— 权限与审计在 Service 层。
 *
 * 硬约束：本文件是管理端唯一读取 QQ / 手机号明文的地方，且只通过
 * `findSensitiveContacts` 暴露，调用方必须写审计（见 `MemberService.getDetail`）。
 */

const adminProfileSelect = {
  id: true,
  userId: true,
  realName: true,
  nickname: true,
  studentId: true,
  className: true,
  status: true,
  version: true,
  joinedAt: true,
  createdAt: true,
  /* 技能标签随列表一起取（第六轮验收）：成员表要直接显示「这个人会什么」，
     不必为此点开详情。用一次带 `in` 的关联查询取整页，不是逐行查询。
     顺序跟成员端一致（标签库的 sortOrder），空标签的成员是空数组。 */
  userSkills: {
    where: { deletedAt: null },
    select: { skill: { select: { id: true, name: true, isActive: true } } },
    orderBy: { skill: { sortOrder: "asc" } },
  },
  user: {
    select: {
      status: true,
      identities: {
        where: { deletedAt: null },
        select: { type: true, identifierNormalized: true },
      },
      roles: {
        where: { revokedAt: null },
        select: { role: { select: { code: true } } },
      },
    },
  },
} as const;

type AdminProfileRow = {
  id: string;
  userId: string;
  realName: string;
  nickname: string | null;
  studentId: string | null;
  className: string | null;
  status: string;
  version: number;
  joinedAt: Date;
  createdAt: Date;
  userSkills: { skill: { id: string; name: string; isActive: boolean } }[];
  user: {
    status: string;
    identities: { type: string; identifierNormalized: string }[];
    roles: { role: { code: string } }[];
  };
};

export const memberRepository = {
  async list(input: MemberListInput): Promise<{ rows: MemberListEntry[]; total: number }> {
    const query = input.query?.trim();
    const where: Prisma.MemberProfileWhereInput = {
      deletedAt: null,
      status: input.status,
      user: {
        deletedAt: null,
        roles: input.role ? { some: { revokedAt: null, role: { code: input.role } } } : undefined,
      },
      // 关键字命中的四个「资料字段」与两个「身份字段」必须是**同一个 OR**。
      // 曾经把身份匹配写在 `user.identities.some` 里与姓名 OR 并列，结果是两者被 AND：
      // 按姓名搜索永远不命中（因为 QQ/手机号里不含姓名），只有搜数字才有效。
      ...(query
        ? {
            OR: [
              { realName: { contains: query } },
              { nickname: { contains: query } },
              { studentId: { contains: query } },
              { className: { contains: query } },
              {
                user: {
                  identities: {
                    some: { deletedAt: null, identifierNormalized: { contains: query } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      getDb().memberProfile.count({ where }),
      getDb().memberProfile.findMany({
        where,
        select: adminProfileSelect,
        /* 顺序 = 管理员拖出来的 `sortOrder`（第九轮验收）。
           新建成员默认 `sortOrder = 0`，与当前位置为 0 的那位并列，靠 `createdAt desc`
           兜底排在最前 —— 也就是「新成员出现在最前面」这条老行为没有丢。
           `id` 再兜一层，保证同秒创建的记录分页稳定（少一层就可能同一行出现两次）。 */
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);

    const stats = await approvedRepairStats(rows.map((row) => row.id));
    return {
      total,
      rows: rows.map((row) => toEntry(row, stats.get(row.id) ?? { count: 0, minutes: 0 })),
    };
  },

  /**
   * 按当前显示顺序取出全部成员档案 id（拖动排序用，第九轮验收）。
   *
   * 排序规则必须与 `list` **逐字一致**：拖动算的是「整份顺序」，落点前后关系一旦与
   * 列表不一致，就会出现「拖到 A 前面，刷新后 A 还在我后面」。
   * 只取 id、不分页：一次拖动要重排的是整份顺序（几十行规模，几十条 update 可接受）。
   * 传 `tx` 时在调用方的事务里执行 —— 顺序读与写必须同事务，否则并发拖动会互相覆盖。
   */
  async orderedIds(tx: Prisma.TransactionClient = getDb()): Promise<string[]> {
    const rows = await tx.memberProfile.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map((row) => row.id);
  },

  async findById(memberProfileId: string): Promise<MemberListEntry | null> {
    const row = await getDb().memberProfile.findFirst({
      where: { id: memberProfileId, deletedAt: null },
      select: adminProfileSelect,
    });
    if (!row) return null;
    const stats = await approvedRepairStats([row.id]);
    return toEntry(row, stats.get(row.id) ?? { count: 0, minutes: 0 });
  },

  /**
   * 读取明文联系方式。**仅供管理端详情使用**：返回值必须伴随一条审计日志。
   * 已软删除的身份不计入（避免把历史解绑的 QQ 当成当前联系方式）。
   */
  async findSensitiveContacts(
    memberProfileId: string,
  ): Promise<{ qq: string | null; phone: string | null }> {
    const row = await getDb().memberProfile.findFirst({
      where: { id: memberProfileId, deletedAt: null },
      select: {
        user: {
          select: {
            identities: {
              where: { deletedAt: null, type: { in: ["QQ", "PHONE"] } },
              select: { type: true, identifierNormalized: true },
            },
          },
        },
      },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND", "成员不存在");
    return {
      qq: row.user.identities.find((item) => item.type === "QQ")?.identifierNormalized ?? null,
      phone:
        row.user.identities.find((item) => item.type === "PHONE")?.identifierNormalized ?? null,
    };
  },

  /**
   * 当前仍持有指定角色且账号有效的用户数。
   * 用于「不能撤销最后一个管理员」这道闸门。
   */
  async countActiveRoleHolders(roleCode: RoleCode): Promise<number> {
    return getDb().userRole.count({
      where: {
        revokedAt: null,
        role: { code: roleCode },
        user: { status: "ACTIVE", deletedAt: null },
      },
    });
  },
};

/** 正式统计口径的维修计数（`APPROVED AND deletedAt IS NULL`），与 M5 保持同一谓词语义。 */
/** 正式统计口径下的维修次数与总时长（一次聚合取整页，不是逐行查询）。 */
type RepairStats = { count: number; minutes: number };

async function approvedRepairStats(memberProfileIds: string[]): Promise<Map<string, RepairStats>> {
  if (memberProfileIds.length === 0) return new Map();
  const grouped = await getDb().repairRecord.groupBy({
    by: ["memberProfileId"],
    where: { memberProfileId: { in: memberProfileIds }, status: "APPROVED", deletedAt: null },
    _count: { _all: true },
    // 时长可能为 NULL（早期记录没填），`_sum` 会忽略它们并可能返回 null。
    _sum: { durationMinutes: true },
  });
  return new Map(
    grouped.map((row) => [
      row.memberProfileId,
      { count: row._count._all, minutes: row._sum.durationMinutes ?? 0 },
    ]),
  );
}

function toEntry(row: AdminProfileRow, stats: RepairStats): MemberListEntry {
  const qq = row.user.identities.find((item) => item.type === "QQ")?.identifierNormalized;
  const phone = row.user.identities.find((item) => item.type === "PHONE")?.identifierNormalized;
  return {
    id: row.id,
    userId: row.userId,
    realName: row.realName,
    nickname: row.nickname,
    studentId: row.studentId,
    className: row.className,
    status: row.status as MemberListEntry["status"],
    roles: row.user.roles
      .map((item) => item.role.code)
      .filter((code): code is RoleCode => code === "MEMBER" || code === "ADMIN")
      // 稳定顺序，避免同一成员两次请求返回不同顺序导致界面抖动。
      .sort(),
    userStatus: row.user.status as MemberListEntry["userStatus"],
    qqMasked: qq ? maskQq(qq) : null,
    phoneMasked: phone ? maskPhone(phone) : null,
    skills: row.userSkills.map((item) => ({
      id: item.skill.id,
      name: item.skill.name,
      isActive: item.skill.isActive,
    })),
    approvedRepairCount: stats.count,
    approvedRepairMinutes: stats.minutes,
    joinedAt: row.joinedAt.toISOString(),
    version: row.version,
  };
}
