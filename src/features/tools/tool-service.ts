import { toolCategories as builtinCategories } from "@/config/tools";
import { toolRepository } from "@/features/tools/tool-repository";
import type { PublicToolGroup } from "@/types/contracts";

/**
 * 公开工具目录读取（`/docs` 页）。
 *
 * 数据源是数据库（后台 `/admin/tools` 维护），但保留**两级兜底**：
 * 1. 数据库连不上（本地没配 `DATABASE_URL`、或迁移还没跑）→ 用内置清单；
 * 2. 数据库连得上但一张表都没数据（还没 `pnpm db:seed`）→ 同样用内置清单。
 *
 * 为什么不在读失败时抛错让页面 500：工具页是纯展示内容，
 * 因为运维状态（没连库 / 没种子）导致整页白屏，对访客是纯损失；
 * 而内置清单与种子数据同源，展示出来的内容完全一致。
 */
export const toolService = {
  async listPublicGroups(): Promise<PublicToolGroup[]> {
    try {
      const groups = await toolRepository.listPublicGroups();
      if (groups.length > 0) return groups;
    } catch {
      // 落到下面的内置清单：工具页不因为数据库状态而白屏。
    }
    return builtinGroups();
  },
};

/** 把 `src/config/tools.ts` 的静态清单转成公开页结构，形状与数据库版本完全一致。 */
function builtinGroups(): PublicToolGroup[] {
  return builtinCategories.map((category) => ({
    id: category.id,
    label: category.label,
    labelEn: category.labelEn,
    sites: category.tools.map((tool, index) => ({
      id: `${category.id}-${index}`,
      name: tool.name,
      href: tool.href,
      description: tool.description,
    })),
  }));
}
