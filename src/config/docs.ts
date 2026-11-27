import { siteConfig } from "@/config/site";

/**
 * 工具索引页（/docs 路由）
 *
 * /docs 现在承载「实用工具 · 网址导航」：上半部分是技术文档知识库入口，
 * 下半部分是常用网址目录。技术文档正文仍由同域 mdBook 承载。
 */
export const docsPage = {
  /** 导航序号与面包屑：「05 / TOOLS · 工具索引」 */
  index: "05",
  title: "实用工具",
  label: "Tools",
  crumbLabel: "工具索引",
  lead: "装机、驱动、解压、游戏、校园……常用官网与排障文档，都归在这里。",
  metadataDescription:
    "浙江农林大学电脑医院实用工具导航，收录装机、驱动、解压、游戏、校园等常用官方网址，以及维修与排障技术文档入口。",
  handbookAction: {
    label: "进入技术文档",
    href: "/handbook/Intro.html",
  },
  repositoryAction: {
    label: "GitHub 文档仓库",
    href: siteConfig.docRepo.url,
  },
  /** 知识库横幅卡的标题与说明 */
  bannerTitle: "技术文档 · 维修与排障知识库",
  bannerDescription: "电脑医院整理的公开文档，同域阅读、可搜索；构建时与文档仓库同步。",
} as const;
