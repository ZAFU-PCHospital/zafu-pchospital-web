import type { Metadata } from "next";

import { RepairAdminPanel } from "@/components/admin/RepairAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.repairs.title };

export default function AdminRepairsPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-repairs-title">
      <div className="admin-workspace__content">
        <RepairAdminPanel />
      </div>
    </Section>
  );
}
