"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
export function InviteRegistrationForm() {
  const router = useRouter();
  const key = useRef(crypto.randomUUID());
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.password !== data.passwordConfirmation) {
      setProblem("两次输入的密码不一致");
      setBusy(false);
      return;
    }
    const response = await fetch("/api/v1/member-registrations/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, idempotencyKey: key.current }),
    });
    const payload = (await response.json()) as { success: boolean; error?: { message?: string } };
    if (!response.ok || !payload.success) {
      setProblem(payload.error?.message ?? "注册失败");
      setBusy(false);
      return;
    }
    router.replace("/member");
    router.refresh();
  }
  const fields = [
    ["code", "邀请码", "text", "off"],
    ["realName", "姓名", "text", "name"],
    ["qq", "QQ 号", "text", "username"],
    ["phone", "手机号", "tel", "tel"],
    ["studentId", "学号（选填）", "text", "off"],
    ["className", "班级（选填）", "text", "off"],
    ["password", "密码", "password", "new-password"],
    ["passwordConfirmation", "确认密码", "password", "new-password"],
  ] as const;
  return (
    <form method="post" className="signup__form" onSubmit={submit}>
      {fields.map(([name, label, type, autoComplete]) => (
        <div className="field" key={name}>
          <label className="field__label" htmlFor={`register-${name}`}>
            {label}
            {name !== "studentId" && name !== "className" ? (
              <span className="field__req">必填</span>
            ) : null}
          </label>
          <input
            className="field__input"
            id={`register-${name}`}
            name={name}
            type={type}
            autoComplete={autoComplete}
            minLength={type === "password" ? PASSWORD_MIN_LENGTH : undefined}
            maxLength={type === "password" ? PASSWORD_MAX_LENGTH : 80}
            required={name !== "studentId" && name !== "className"}
          />
        </div>
      ))}
      <div className="signup__actions">
        <Button type="submit" variant="solid" disabled={busy}>
          {busy ? "注册中" : "注册成员账号"}
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
