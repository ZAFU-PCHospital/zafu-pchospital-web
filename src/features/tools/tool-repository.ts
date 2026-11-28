import { getDb } from "@/lib/db/client";
import type { PublicToolGroup } from "@/types/contracts";

/**
 * 工具导航数据访问。
 *
 * 只负责读取与默认软删除过滤，不做权限、校验或事务 —— 与 `skill-repository` 同一分工。
 * 公开页与后台列表共用这里的查询形状。
 */

const categorySelect = {
  id: true,
  code: true,
  name: true,
  labelEn: true,
  description: true,
  sortOrder: true,
  isActive: true,
} as const;

const siteSelect = {
  id: true,
  categoryId: true,
  name: true,
  url: true,
  description: true,
  sortOrder: true,
  isActive: true,
} as const;

export type ToolCategoryRow = {
  id: string;
  code: string;
  name: string;
  labelEn: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type ToolSiteRow = {
  id: string;
  categoryId: string;
  name: string;
  url: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export const toolRepository = {
  /** 后台/公开共用的分类顺序：启用状态由调用方过滤。 */
  async listCategories(options: { activeOnly: boolean }): Promise<ToolCategoryRow[]> {
    return getDb().toolCategory.findMany({
      where: {
        deletedAt: null,
        ...(options.activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: categorySelect,
    });
  },

  /** 网站列表；`categoryId` 传值即只取该组（拖动排序需要按组取全集）。 */
  async listSites(options: { activeOnly: boolean; categoryId?: string }): Promise<ToolSiteRow[]> {
    return getDb().toolSite.findMany({
      where: {
        deletedAt: null,
        ...(options.activeOnly ? { isActive: true } : {}),
        ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: siteSelect,
    });
  },

  /**
   * 公开页需要的两层结构：启用中的分组 + 组内启用中的网站。
   *
   * null 表示从未录入任何数据，空数组表示数据库里没有可公开的网站。
   */
  async listPublicGroups(): Promise<PublicToolGroup[] | null> {
    const [categories, sites] = await Promise.all([
      this.listCategories({ activeOnly: true }),
      this.listSites({ activeOnly: true }),
    ]);
    const byCategory = new Map<string, PublicToolGroup["sites"]>();
    for (const site of sites) {
      const bucket = byCategory.get(site.categoryId);
      const entry = {
        id: site.id,
        name: site.name,
        href: site.url,
        description: site.description ?? "",
      };
      if (bucket) bucket.push(entry);
      else byCategory.set(site.categoryId, [entry]);
    }
    const groups = categories
      .map((category) => ({
        id: category.id,
        label: category.name,
        labelEn: category.labelEn ?? "",
        sites: byCategory.get(category.id) ?? [],
      }))
      // 空分组不渲染：后台把一组里的网站全停用后，公开页不该留一个空标题。
      .filter((group) => group.sites.length > 0);
    if (groups.length > 0 || categories.length > 0 || sites.length > 0) return groups;

    return (await this.hasRecords()) ? [] : null;
  },

  /** 历史行也表示目录已由后台接管。 */
  async hasRecords(): Promise<boolean> {
    const db = getDb();
    const [category, site] = await Promise.all([
      db.toolCategory.findFirst({ select: { id: true } }),
      db.toolSite.findFirst({ select: { id: true } }),
    ]);
    return Boolean(category || site);
  },

  /** 每组的启用网站数，后台列表用它提示「停用这一组会隐藏几个」。 */
  async countSitesByCategory(): Promise<Map<string, number>> {
    const rows = await getDb().toolSite.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null, isActive: true },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.categoryId, row._count._all]));
  },
};
