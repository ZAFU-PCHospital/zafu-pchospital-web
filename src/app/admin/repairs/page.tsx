import type { Metadata } from "next";

import { RepairAdminPanel } from "@/components/admin/RepairAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";
import { requireAdminPage } from "@/lib/auth/admin-page";

export const metadata: Metadata = { title: adminCopy.repairs.title };

export default async function AdminRepairsPage() {
  const principal = await requireAdminPage();
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-repairs-title">
      <div className="admin-workspace__content">
        <RepairAdminPanel canReview={principal.permissions.includes("repair:review")} />
      </div>
    </Section>
  );
}
