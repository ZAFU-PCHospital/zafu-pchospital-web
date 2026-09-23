import type { Metadata } from "next";

import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.audit.title };

export default function AdminAuditPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-audit-title">
      <div className="admin-workspace__content">
        <AuditLogPanel />
      </div>
    </Section>
  );
}
