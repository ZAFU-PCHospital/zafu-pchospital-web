import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";
import { docPageUrl, docTree, flattenDocTree } from "@/lib/docs";

/**
 * sitemap.xml（构建期生成）
 *
 * 只列公开且无需登录的页面：五个主栏目（含 /docs 工具页）+ 站内技术文档。
 *
 * 两条约束：
 * - 后台（/admin）、成员工作台（/member）、账号页（/account）与接口不收录，
 *   与 `robots.ts` 的屏蔽名单互补；
 * - 本文件在构建期生成，而 CI 上**没有数据库**，所以这里不能查维修活动或维修记录，
 *   只能读构建时已有的静态数据（文档条目来自 `docTree`，即文档清单）。
 *   活动详情页因此不进 sitemap —— 它们靠站内链接被爬虫发现。
 */

const staticRoutes: MetadataRoute.Sitemap = [
  { url: "/", changeFrequency: "weekly", priority: 1 },
  { url: "/repair-activities", changeFrequency: "weekly", priority: 0.8 },
  { url: "/docs", changeFrequency: "monthly", priority: 0.7 },
  { url: "/about", changeFrequency: "monthly", priority: 0.6 },
  { url: "/join", changeFrequency: "monthly", priority: 0.6 },
];

function absolute(path: string): string {
  return `${siteConfig.url}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    ...route,
    url: absolute(route.url),
  }));

  for (const item of flattenDocTree(docTree)) {
    if (item.type !== "item" || item.pending || !item.outputPath) continue;
    entries.push({
      url: absolute(docPageUrl(item.outputPath)),
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  return entries;
}
