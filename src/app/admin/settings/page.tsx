import type { Metadata } from "next";

import { PublicContentSettingsPanel } from "@/components/admin/PublicContentSettingsPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.settings.title };

export default function AdminSettingsPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-settings-title">
      <div className="admin-workspace__content">
        <PublicContentSettingsPanel />
      </div>
    </Section>
  );
}
