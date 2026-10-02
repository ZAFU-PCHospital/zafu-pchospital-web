import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginPanel, type AuthPanelMode } from "@/components/auth/LoginPanel";
import { Section } from "@/components/ui/Section";
import { authService } from "@/features/auth/auth-service";
import { AppError } from "@/lib/api/errors";
import { loginDestination } from "@/lib/auth/login-destination";
import { SESSION_COOKIE_NAME } from "@/lib/auth/request";

export const metadata: Metadata = { title: "成员登录" };

type LoginPageProps = {
  searchParams: Promise<{ mode?: string | string[]; reason?: string | string[] }>;
};

function resolveMode(raw: string | string[] | undefined): AuthPanelMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "register" ? "register" : "login";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const params = await searchParams;
  let destination: string | undefined;
  if (token) {
    try {
      destination = loginDestination(await authService.authenticate(token));
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        ![
          "AUTH_SESSION_INVALID",
          "AUTH_SESSION_EXPIRED",
          "ACCOUNT_DISABLED",
          "MEMBER_PROFILE_INACTIVE",
        ].includes(error.code)
      )
        throw error;
      if (!Array.isArray(params.reason) && params.reason !== "expired")
        redirect("/login?reason=expired");
    }
  }
  if (destination) redirect(destination);
  const mode = resolveMode(params.mode);

  return (
    <Section variant="page-head" className="auth-login" labelledBy="login-title">
      <LoginPanel mode={mode} />
    </Section>
  );
}
