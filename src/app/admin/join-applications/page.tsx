import type { Metadata } from "next";

import { JoinApplicationAdminPanel } from "@/components/admin/JoinApplicationAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.recruitment.title };

export default function AdminRecruitmentPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-recruitment-title">
      <div className="admin-workspace__content">
        <JoinApplicationAdminPanel />
      </div>
    </Section>
  );
}
