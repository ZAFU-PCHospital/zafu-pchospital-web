import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/AdminNav";
import { adminCopy } from "@/config/admin";
import { requireAdminPage } from "@/lib/auth/admin-page";

export const metadata: Metadata = {
  title: adminCopy.title,
  // 管理后台不进搜索引擎索引；页面本身也需要登录才可渲染。
  robots: { index: false, follow: false },
};

/**
 * `/admin/**` 的统一守卫层 + 后台外壳。
 *
 * 守卫放在 layout 而不是每个 page：后台每个页面都必须先通过 `requireAdminPage()`，
 * 放在这里可以保证新增页面不会忘记加守卫（`/admin` 首页自身也在其中）。
 * 数据接口另有独立的 `requirePermission` 校验，前端守卫只是「页面能不能渲染」这一道。
 *
 * **外壳（左侧栏 + 内容区）也放在这里**：layout 在客户端导航之间保持挂载，
 * 于是切页时侧栏不重建、滚动位置与高亮状态都不抖。原先导航在 11 个页面里各渲染一次，
 * 每次切页都要重新挂载整条导航 —— 这是「停顿感」的一部分来源。
 * 页面的 `<Section>` 仍在各自 page 里（它承载每页自己的 `aria-labelledby`）。
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="admin-shell">
      <AdminNav />
      <div className="admin-shell__main">{children}</div>
    </div>
  );
}
