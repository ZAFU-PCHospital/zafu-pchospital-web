import { appendAuditLog } from "@/lib/audit/audit-service";
import { AppError } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { resolveDisplayName } from "@/features/analytics/analytics-policy";
import { RankingDisplayNameMode } from "@/types/contracts";
import type {
  AuthorizedActor,
  PublicContentSettings,
  PublicContentSettingsServiceContract,
  RankingDisplayNameMode as RankingMode,
  UpdatePublicContentSettingsInput,
} from "@/types/contracts";

/**
 * 单行配置行主键。
 *
 * 用固定字符串而不是 uuid：这张表在业务上**只有一行**（「官网对外展示什么」是一份全局策略，
 * 不存在「第二条策略」），主键即单行约束；写入一律 upsert 这一行。
 */
export const PUBLIC_CONTENT_SETTINGS_ID = "public-content";

/**
 * 未配置时的契约默认值：**三个开关全关，展示名取昵称**。
 *
 * 保守默认是刻意的 —— 表里没有行时（全新部署、M7 尚未接入）官网不应该展示任何真实统计，
 * 而不是因为「读不到配置」就退化成公开。这与 M3 的 `UNCONFIGURED` 口径一致：
 * 未知不等于开放。展示名默认 `NICKNAME`：即使管理员打开了排行榜，
 * 默认也不会把成员真实姓名推到公网。
 */
export const PUBLIC_CONTENT_SETTINGS_DEFAULTS: UpdatePublicContentSettingsInput = {
  publicRepairStatsEnabled: false,
  publicRepairStatsDetailEnabled: false,
  publicRankingsEnabled: false,
  rankingDisplayName: "NICKNAME",
};

/**
 * 公开内容与展示策略（M6 批次 2，需求 §31 / §32 / §74）。
 *
 * 需求 §74 明确「最终展示策略由管理员配置」，§4.4 也把「管理首页公开统计配置」列为管理员能力。
 * 这是一份**要留痕的持久化配置**，所以既不能硬编码在前端，也不适合放环境变量
 * （环境变量改不了、也没有变更记录）。
 *
 * M7 接入官网公开数据时消费这份配置；本模块只负责存储与校验。
 */
export const publicContentSettingsService: PublicContentSettingsServiceContract = {
  async get(actor: AuthorizedActor): Promise<PublicContentSettings> {
    requirePermission(actor, "settings:manage");
    return read();
  },

  async update(
    input: UpdatePublicContentSettingsInput,
    actor: AuthorizedActor,
  ): Promise<PublicContentSettings> {
    requirePermission(actor, "settings:manage");
    validate(input);
    // 不变量：辅助数据（本学期数 / 累计时长）不能脱离主数据（累计服务台数）单独存在。
    // 主开关关掉时**归零而不是报错** —— 否则管理员想关掉首页统计，
    // 会因为「辅助数据那格还留着 true」被 400 拦住，得先去点两次才能达成一个动作。
    const normalized: UpdatePublicContentSettingsInput = {
      ...input,
      publicRepairStatsDetailEnabled:
        input.publicRepairStatsEnabled && input.publicRepairStatsDetailEnabled,
    };
    const before = await read();
    const now = new Date();
    await inSerializableTransaction(async (tx) => {
      await tx.publicContentSetting.upsert({
        where: { id: PUBLIC_CONTENT_SETTINGS_ID },
        // 首次写入（库里还没有这一行）同样要记下操作者：
        // 只在 `update` 分支写 `updatedByUserId` 会让「第一次配置」查不出是谁做的。
        create: {
          id: PUBLIC_CONTENT_SETTINGS_ID,
          ...normalized,
          updatedByUserId: actor.userId ?? null,
          createdAt: now,
          updatedAt: now,
        },
        update: { ...normalized, updatedByUserId: actor.userId ?? null, updatedAt: now },
      });
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "settings.public_content.updated",
        targetType: "PublicContentSetting",
        targetId: PUBLIC_CONTENT_SETTINGS_ID,
        result: "SUCCESS",
        before: {
          publicRepairStatsEnabled: before.publicRepairStatsEnabled,
          publicRepairStatsDetailEnabled: before.publicRepairStatsDetailEnabled,
          publicRankingsEnabled: before.publicRankingsEnabled,
          rankingDisplayName: before.rankingDisplayName,
        },
        after: normalized,
      });
    });
    return read();
  },
};

async function read(): Promise<PublicContentSettings> {
  const row = await getDb().publicContentSetting.findUnique({
    where: { id: PUBLIC_CONTENT_SETTINGS_ID },
    include: {
      updatedBy: {
        select: {
          id: true,
          displayName: true,
          memberProfile: { select: { nickname: true, realName: true } },
        },
      },
    },
  });
  if (!row) {
    return { ...PUBLIC_CONTENT_SETTINGS_DEFAULTS, updatedAt: null, updatedBy: null };
  }
  return {
    publicRepairStatsEnabled: row.publicRepairStatsEnabled,
    publicRepairStatsDetailEnabled: row.publicRepairStatsDetailEnabled,
    publicRankingsEnabled: row.publicRankingsEnabled,
    rankingDisplayName: row.rankingDisplayName as RankingMode,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
      ? {
          userId: row.updatedBy.id,
          name: resolveDisplayName({
            nickname: row.updatedBy.memberProfile?.nickname ?? null,
            realName: row.updatedBy.memberProfile?.realName ?? null,
            displayName: row.updatedBy.displayName,
          }),
        }
      : null,
  };
}

function validate(input: UpdatePublicContentSettingsInput): void {
  if (
    typeof input.publicRepairStatsEnabled !== "boolean" ||
    typeof input.publicRepairStatsDetailEnabled !== "boolean" ||
    typeof input.publicRankingsEnabled !== "boolean"
  ) {
    throw new AppError("PUBLIC_SETTINGS_INVALID", "公开统计开关必须是布尔值");
  }
  if (!(RankingDisplayNameMode as readonly string[]).includes(input.rankingDisplayName)) {
    throw new AppError("PUBLIC_SETTINGS_INVALID", "排行榜展示名只能是实名、昵称或隐藏");
  }
}
