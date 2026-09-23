import type { Metadata } from "next";

import { MemberDashboard } from "@/components/member/MemberDashboard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { memberCopy } from "@/config/member";
import { requireMemberPage } from "@/lib/auth/member-page";

export const metadata: Metadata = { title: memberCopy.dashboard.title };

/**
 * `/member` —— 成员工作台
 *
 * 用 `requireMemberPage()`（只保证登录 + 已改密）而不是 `requireActiveMemberPage()`：
 * 已登录但还没有有效成员档案的用户**不能**在这里被重定向到 `/member`，
 * 否则会与 `requireActiveMemberPage()` 形成重定向自环。这类用户走下面的空态分支。
 */
export default async function MemberPage() {
  const principal = await requireMemberPage();
  const isActiveMember = Boolean(principal.memberProfileId) && principal.memberStatus === "ACTIVE";

  if (!isActiveMember) {
    // 管理员账号（只有 ADMIN 角色、没有成员档案）是合法存在的：M1 的账号发放与 M6 的
    // 「新增成员」都会产生这类账号。原先这里只给一个「返回首页」，于是管理员误入
    // `/member`（例如手输地址、或从旧的收藏/历史进来）时会看到一句「尚未开通成员身份」，
    // 既没有解释也没有回后台的路，读起来就是「进不去了」。有 ADMIN 角色时补上后台入口。
    const isAdmin = principal.roles.includes("ADMIN");
    return (
      <Section variant="page-head" className="member-workspace" labelledBy="member-title">
        <h1 className="sr-only" id="member-title">
          {memberCopy.dashboard.title}
        </h1>
        <Card variant="notice">
          <p>{memberCopy.noProfile.title}</p>
          <p>{isAdmin ? memberCopy.noProfile.adminNote : memberCopy.noProfile.note}</p>
          <div className="signup__actions">
            {isAdmin ? <Button href="/admin">进入管理后台</Button> : null}
            <Button href="/" variant={isAdmin ? "ghost" : "outline"}>
              返回首页
            </Button>
          </div>
        </Card>
      </Section>
    );
  }

  return (
    <Section variant="page-head" className="member-workspace" labelledBy="member-title">
      <MemberDashboard
        initialDisplayName={principal.displayName ?? memberCopy.common.fallbackName}
        roles={principal.roles}
      />
    </Section>
  );
}
