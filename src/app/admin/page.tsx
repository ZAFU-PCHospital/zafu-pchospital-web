import type { Metadata } from "next";

import { ChannelList } from "@/components/ui/ChannelList";
import { Section } from "@/components/ui/Section";
import { SectionHead } from "@/components/ui/SectionHead";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { ADMIN_SECTION_INDEX, adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.title };

/** 后台首页：只做「入口索引」，不含任何统计数字（避免与 M5 的正式口径重复或漂移）。 */
export default function AdminHomePage() {
  const copy = adminCopy.home;
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-home-title">
      <div className="admin-workspace__content">
        <div className="admin-workspace__header">
          <div>
            <h1 className="admin-workspace__title" id="admin-home-title">
              {adminCopy.title}
            </h1>
            <p className="admin-workspace__lead">{copy.lead}</p>
          </div>
        </div>
        <SectionHead index={ADMIN_SECTION_INDEX.home} label={copy.label} />
        <SectionTitle as="h2" index={1}>
          管理模块
        </SectionTitle>
        <ChannelList
          items={copy.sections.map((section) => ({
            kind: section.index,
            title: section.title,
            description: section.description,
            href: section.href,
          }))}
        />
      </div>
    </Section>
  );
}
