import type { Metadata } from "next";

// 后台与公开页共用同一套卡片样式：视觉只有一份定义，改前台就等于改后台。
import "@/app/docs/tools.css";
import "./tools-admin.css";

import { ToolAdminPanel } from "@/components/admin/ToolAdminPanel";
import { Section } from "@/components/ui/Section";
import { adminCopy } from "@/config/admin";
import { requireAdminPage } from "@/lib/auth/admin-page";

export const metadata: Metadata = { title: adminCopy.tools.title };

/**
 * 工具导航管理。只有 `tool:manage` 权限（当前即 ADMIN）能进：
 * 守卫在 `requireAdminPage` 里统一处理，与其余后台页一致。
 */
export default async function AdminToolsPage() {
  await requireAdminPage();
  return (
    <Section variant="page-head" className="admin-workspace" labelledBy="admin-tools-title">
      <ToolAdminPanel />
    </Section>
  );
}
