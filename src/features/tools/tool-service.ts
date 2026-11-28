import { toolCategories as builtinCategories } from "@/config/tools";
import { toolRepository } from "@/features/tools/tool-repository";
import type { PublicToolGroup } from "@/types/contracts";

/** 数据库不可读或尚无任何工具记录时使用内置清单。 */
export const toolService = {
  async listPublicGroups(): Promise<PublicToolGroup[]> {
    try {
      return (await toolRepository.listPublicGroups()) ?? builtinGroups();
    } catch (error) {
      console.warn("[tools] 读取公开工具导航失败，使用内置清单", {
        code:
          typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
        type: error instanceof Error ? error.name : typeof error,
      });
      return builtinGroups();
    }
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
