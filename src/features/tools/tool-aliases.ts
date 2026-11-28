import { toolCategories } from "@/config/tools";

/**
 * 检索别名补充层
 *
 * 访客搜「解压」「u 盘」「装机」这类用途词时，站点名本身往往不含这些字。
 * 内置清单（src/config/tools.ts）为每条记录写了 keywords，但数据库里的分类与网址
 * 并没有别名列——后台只维护名称、地址、分类、描述四项。
 *
 * 这里按「地址」「分类名」把内置别名取回来，与前台的名称/描述一起参与匹配。
 * 于是后台改了网址也不影响搜索：只要地址没变，别名就还在。
 *
 * 已知边界：后台新增的条目不在这份清单里，只能靠名称与描述命中。
 * 若后续确实需要给新条目配别名，再给表加 keywords 列即可，本模块可整段删掉。
 */

/** 归一化检索文本：忽略大小写与空白，让「驱动 下载」也能命中「驱动下载」。 */
export function keywordOf(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

/** 外链归一化：忽略大小写与末尾斜杠，避免存储时多了个 `/` 就匹配不上别名。 */
function normalizeHref(href: string) {
  return href.trim().toLowerCase().replace(/\/+$/, "");
}

const siteAliases = new Map<string, string>();
const categoryAliases = new Map<string, string>();

for (const category of toolCategories) {
  const categoryWords = category.keywords ?? [];
  if (categoryWords.length > 0) {
    categoryAliases.set(keywordOf(category.label), categoryWords.join(""));
  }

  for (const tool of category.tools) {
    const toolWords = tool.keywords ?? [];
    if (toolWords.length > 0) {
      siteAliases.set(normalizeHref(tool.href), toolWords.join(""));
    }
  }
}

/** 某条网址的检索别名（无则空串）。 */
export function siteAlias(href: string) {
  return siteAliases.get(normalizeHref(href)) ?? "";
}

/** 某个分类的检索别名（无则空串）。按分类名匹配，后台改名后即失效。 */
export function categoryAlias(label: string) {
  return categoryAliases.get(keywordOf(label)) ?? "";
}
