import type { Metadata } from "next";

import { CommentAdminPanel } from "@/components/admin/CommentAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";

export const metadata: Metadata = { title: adminCopy.comments.title };

export default function AdminCommentsPage() {
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-comments-title">
      <div className="admin-workspace__content">
        <CommentAdminPanel />
      </div>
    </Section>
  );
}
