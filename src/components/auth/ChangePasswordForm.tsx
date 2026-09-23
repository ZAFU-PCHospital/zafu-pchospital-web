"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
export function ChangePasswordForm() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/auth/password/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
        newPasswordConfirmation: data.get("newPasswordConfirmation"),
      }),
    });
    const payload = (await response.json()) as { success: boolean; error?: { message?: string } };
    if (!response.ok || !payload.success) {
      setProblem(payload.error?.message ?? "修改失败");
      setBusy(false);
      return;
    }
    router.replace("/member");
    router.refresh();
  }
  return (
    <form method="post" className="signup__form" onSubmit={submit}>
      {[
        ["currentPassword", "当前密码", "current-password"],
        ["newPassword", "新密码", "new-password"],
        ["newPasswordConfirmation", "确认新密码", "new-password"],
      ].map(([name, label, autoComplete]) => (
        <div className="field" key={name}>
          <label className="field__label" htmlFor={`password-${name}`}>
            {label}
            <span className="field__req">必填</span>
          </label>
          <input
            className="field__input"
            id={`password-${name}`}
            name={name}
            type="password"
            autoComplete={autoComplete}
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            required
          />
        </div>
      ))}
      <p className="field__hint">
        {`密码长度为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符；修改后其他登录会话将立即失效。`}
      </p>
      <div className="signup__actions">
        <Button type="submit" variant="solid" disabled={busy}>
          {busy ? "保存中" : "修改密码"}
        </Button>
      </div>
      {problem ? (
        <p className="signup__status signup__status--alert" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
