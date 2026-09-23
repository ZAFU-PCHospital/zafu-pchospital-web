import type { Metadata } from "next";

import { CategoryAdminPanel } from "@/components/admin/CategoryAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.categories.title };

export default function AdminCategoriesPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-categories-title">
      <div className="admin-workspace__content">
        <CategoryAdminPanel />
      </div>
    </Section>
  );
}
