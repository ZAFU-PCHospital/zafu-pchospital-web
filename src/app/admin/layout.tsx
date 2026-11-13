import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/AdminNav";
import { MemberShell } from "@/components/member/MemberShell";
import { headers } from "next/headers";
import { requireActivityPage } from "@/lib/auth/activity-page";
import { isActivityObjectPath } from "@/lib/auth/activity-workspace-access";
import { INTERNAL_PATHNAME_HEADER } from "@/lib/auth/internal-pathname";
import { adminCopy } from "@/config/admin";
import { requireAdminPage } from "@/lib/auth/admin-page";

export const metadata: Metadata = {
  title: adminCopy.title,
  // 管理后台不进搜索引擎索引；页面本身也需要登录才可渲染。
  robots: { index: false, follow: false },
};

/** 后台导航由持久 layout 承载，切页时保留挂载。 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const activityObject = isActivityObjectPath((await headers()).get(INTERNAL_PATHNAME_HEADER));
  const principal = await (activityObject ? requireActivityPage() : requireAdminPage());
  if (!principal.roles.includes("ADMIN")) {
    return <MemberShell displayName={principal.displayName}>{children}</MemberShell>;
  }
  return (
    <div className="admin-shell">
      <AdminNav displayName={principal.displayName} />
      <div className="admin-shell__main">{children}</div>
    </div>
  );
}
