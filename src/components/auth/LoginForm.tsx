"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { loginCopy } from "@/config/auth";

export function LoginForm() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qq: data.get("qq"), password: data.get("password") }),
    });
    const payload = (await response.json()) as {
      success: boolean;
      data?: { mustChangePassword?: boolean; roles?: string[] };
      error?: { message?: string };
    };
    if (!response.ok || !payload.success) {
      setProblem(payload.error?.message ?? loginCopy.failed);
      setBusy(false);
      return;
    }
    // 管理员落到管理后台：只有 ADMIN 角色、没有成员档案的账号在 /member 上只会看到
    // 「尚未开通成员身份」的空态，等于进不去任何页面（M6 之后 /admin 才是它的落点）。
    const isAdmin = payload.data?.roles?.includes("ADMIN") ?? false;
    router.replace(
      payload.data?.mustChangePassword
        ? "/account/change-password"
        : isAdmin
          ? "/admin"
          : "/member",
    );
    router.refresh();
  }
  return (
    // method="post"：JS 未 hydrate 时浏览器会退化成原生提交。没有它默认是 GET，
    // 会把 QQ 与**密码明文拼进 URL**（历史记录、访问日志、Referer 全都拿得到）。
    // M1 任务书明确要求凭据不得进入 URL，因此这里必须显式声明 POST。
    <form className="auth-login__form" method="post" onSubmit={submit}>
      <Field
        name="qq"
        label={loginCopy.qqLabel}
        placeholder={loginCopy.qqPlaceholder}
        type="text"
        autoComplete="username"
        minLength={5}
        maxLength={11}
      />
      <Field
        name="password"
        label={loginCopy.passwordLabel}
        placeholder={loginCopy.passwordPlaceholder}
        type="password"
        autoComplete="current-password"
        // **不设 `minLength`**：登录是校验密码，不是设置密码。写死下限的后果是
        // 「用短口令的账号在前端就被拦住、连提交都提交不了」（第十一轮实测踩到：
        // 验收账号密码 123456，登录表单上写着 minLength={12}）。长度规则只在
        // 设置 / 修改密码处生效，登录交给服务端判定。
        maxLength={128}
      />
      <Button className="auth-login__submit" type="submit" variant="solid" disabled={busy}>
        {busy ? loginCopy.submitting : loginCopy.submit}
      </Button>
      {problem ? (
        <p className="auth-login__problem" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

function Field(props: {
  name: string;
  label: string;
  placeholder: string;
  type: string;
  autoComplete: string;
  minLength?: number;
  maxLength: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = props.type === "password";
  return (
    <div className="field">
      <label className="field__label" htmlFor={`auth-${props.name}`}>
        {props.label}
      </label>
      <div className={isPassword ? "auth-login__password" : undefined}>
        <input
          className="field__input"
          id={`auth-${props.name}`}
          name={props.name}
          type={isPassword && revealed ? "text" : props.type}
          inputMode={props.name === "qq" ? "numeric" : undefined}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
          minLength={props.minLength}
          maxLength={props.maxLength}
          required
        />
        {isPassword ? (
          <button
            className="auth-login__password-toggle"
            type="button"
            aria-label={revealed ? loginCopy.hidePassword : loginCopy.showPassword}
            aria-pressed={revealed}
            onClick={() => setRevealed((visible) => !visible)}
          >
            <Icon name={revealed ? "eyeOff" : "eye"} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
