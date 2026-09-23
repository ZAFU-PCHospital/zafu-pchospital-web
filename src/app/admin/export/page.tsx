import type { Metadata } from "next";

import { ExportPanel } from "@/components/admin/ExportPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.export.title };

export default function AdminExportPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-export-title">
      <div className="admin-workspace__content">
        <ExportPanel />
      </div>
    </Section>
  );
}
