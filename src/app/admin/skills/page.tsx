import type { Metadata } from "next";

import { SkillAdminPanel } from "@/components/admin/SkillAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.skills.title };

export default function AdminSkillsPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-skills-title">
      <div className="admin-workspace__content">
        <SkillAdminPanel />
      </div>
    </Section>
  );
}
