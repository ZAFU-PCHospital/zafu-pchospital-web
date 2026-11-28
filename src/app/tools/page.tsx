import type { Metadata } from "next";

import { DocBanner } from "@/components/docs/DocBanner";
import { ToolDirectory } from "@/components/docs/ToolDirectory";
import { docsPage } from "@/config/docs";
import { toolService } from "@/features/tools/tool-service";
import { docMeta, formatGeneratedAt } from "@/lib/docs";

import "./tools.css";

export const metadata: Metadata = {
  title: docsPage.title,
  description: docsPage.metadataDescription,
};

/**
 * 每次请求都重新读库。
 *
 * 工具目录的数据来自数据库（后台 `/admin/tools` 维护），静态预渲染会在构建那一刻
 * 把结果冻住 —— 管理员加一个网站后要等下一次重新部署才看得见，这正是本需求要解决的问题。
 * 页面本身是纯读取、两次索引查询，动态渲染的代价可以忽略。
 * 数据库不可用时 `toolService` 会退回内置清单，构建期无库也能通过。
 */
export const dynamic = "force-dynamic";

/**
 * /tools 工具索引页
 *
 * 结构：面包屑 → 标题导语 → 技术文档知识库横幅卡 → 工具网址目录 → 页脚说明行。
 * 技术文档正文由独立仓库生成到同域 /handbook/，本页只保留入口；
 * 工具数据由 `toolService` 提供（数据库优先，缺数据/连不上时用内置清单）。
 *
 * 版式按设计稿复刻（字号 / 间距 / 密度）；颜色统一映射语义令牌（见 tools.css 顶部注释），
 * 因此不使用 Section / SectionHead 等展示页版式组件。
 */
export default async function ToolsPage() {
  const groups = await toolService.listPublicGroups();

  return (
    <div className="tp">
      <p className="tp-crumb">
        <b>
          {docsPage.index} / {docsPage.label}
        </b>{" "}
        · {docsPage.crumbLabel}
      </p>

      <h1 className="tp-title">{docsPage.title}</h1>
      <p className="tp-lead">{docsPage.lead}</p>

      <DocBanner />
      <ToolDirectory groups={groups} />

      <div className="tp-foot">
        <span>外链均为官方网站，在新窗口打开</span>
        <span>文档统计数据更新于 {formatGeneratedAt(docMeta.generatedAt)}</span>
      </div>
    </div>
  );
}
