import type { Metadata } from "next";

import { MemberAdminPanel } from "@/components/admin/MemberAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.members.title };

export default function AdminMembersPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-members-title">
      <div className="admin-workspace__content">
        <MemberAdminPanel />
      </div>
    </Section>
  );
}
