import type { Prisma } from "@/generated/prisma/client";

import { startOfShanghaiDay } from "@/lib/academic-term";

/**
 * 公开列表两段（未结束 / 已结束）的 SQL 条件，与 ENDED 判定同口径（issue #362）：
 * 已结束 = `now >= COALESCE(ends_at, 活动日次日 00:00 上海)`。
 *
 * Prisma 不支持 COALESCE 比较，等价拆成「ends_at 已过」+「ends_at 为空且 activity_at
 * 早于今日零点（上海）」两支。SQL 里 `ends_at <= ?` 对 NULL 行不成立，历史活动只会走第二支；
 * 两支互斥且并为全集，因此 `total = 未结束 + 已结束` 仍成立。
 */
export function publicActivitySegmentWheres(now: Date): {
  active: Prisma.RepairActivityWhereInput;
  ended: Prisma.RepairActivityWhereInput;
} {
  const todayStart = startOfShanghaiDay(now);
  return {
    active: {
      deletedAt: null,
      OR: [{ endsAt: { gt: now } }, { endsAt: null, activityAt: { gte: todayStart } }],
    },
    ended: {
      deletedAt: null,
      OR: [{ endsAt: { lte: now } }, { endsAt: null, activityAt: { lt: todayStart } }],
    },
  };
}
