import type { SkillView } from "@/types/contracts";

/**
 * 技能标签选择器的选项表（**纯函数，不碰数据库**）。
 *
 * 单独成一个模块而不是放在 `skill-service.ts` 里：服务端的 Service 会连带引入
 * `lib/db/client` → Prisma → MariaDB 驱动，而 **`MemberProfileEditor` 是客户端组件**。
 * 把纯函数留在那里会让客户端 bundle 去解析 node 的 `net` 模块，
 * `next build` 直接报 `Module not found: Can't resolve 'net'`（实际踩到过）。
 * 客户端组件只能从这种不含服务端依赖的模块里取东西。
 *
 * `/api/v1/skills` 按契约只返回启用项，因此**已停用的历史标签要从成员资料里补回来**：
 * 否则它们继续占用上限，成员却找不到取消入口。
 */
export function mergeSkillOptions(
  availableSkills: readonly SkillView[],
  selectedSkills: readonly SkillView[],
): SkillView[] {
  const byId = new Map(selectedSkills.map((skill) => [skill.id, skill]));
  for (const skill of availableSkills) byId.set(skill.id, skill);
  return [...byId.values()].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hans-CN"),
  );
}
