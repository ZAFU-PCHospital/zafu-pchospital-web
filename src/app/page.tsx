import { ContactSection } from "@/components/home/ContactSection";
import { DocsSection } from "@/components/home/DocsSection";
import { Hero } from "@/components/home/Hero";
import { HomeActivityPreview } from "@/components/home/HomeActivityPreview";
import { HomePublicAnalytics } from "@/components/home/HomePublicAnalytics";
import { ProcessSection } from "@/components/home/ProcessSection";
import { Ticker } from "@/components/home/Ticker";
import { publicHomeService } from "@/features/analytics/public-home-service";

// 公开策略与维修数据在请求时读取，后台保存后刷新首页即可生效。
export const dynamic = "force-dynamic";

/**
 * 首页
 *
 * 区块顺序：首屏（Hero + 跑马灯）→ 依策略公开的服务记录第二屏 → 近场活动 → 流程 → 文档 → 联系。
 * 文案数据来自 src/config/home.ts 与 src/config/site.ts。
 */

export default async function HomePage() {
  const analytics = await publicHomeService.get();
  const hasAnalytics = Boolean(analytics.repairStats || analytics.rankings);
  return (
    <>
      <div className="home-first-screen">
        <Hero
          analytics={analytics}
          scrollTarget={hasAnalytics ? "#public-statistics" : "#home-content"}
        />
        <Ticker />
      </div>
      <div id="home-content">
        <HomePublicAnalytics data={analytics} />
        <HomeActivityPreview />
        <ProcessSection />
        <DocsSection />
        <ContactSection />
      </div>
    </>
  );
}
