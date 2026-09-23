import { basename } from "node:path";

/** 显式放行破坏性测试的环境变量（只在你确实想对着这个库跑时才设）。 */
const OVERRIDE = "ALLOW_DESTRUCTIVE_DB_TESTS";

/**
 * 破坏性集成测试（会**整表清空**的那几个）开跑前的闸门。
 *
 * 为什么需要它：`pnpm test:db` 用的是 `.env` 里的 `DATABASE_URL`，而本地 `.env` 指的
 * 是**开发库** —— 于是「跑一遍测试」的后果是把开发库的 `user_identities`、
 * `password_credentials`、`member_profiles`、`audit_logs` 全部清空。
 * 2026-09-23 实际发生过一次：开发库里所有账号**同时失去登录身份**（登录报
 * 「QQ 号或密码错误」，因为查不到那条 QQ 身份），而 `users` 因为
 * `public_content_settings.updated_by_user_id` 的 RESTRICT 外键没被删掉，
 * 留下 254 个「有用户、没身份」的孤儿；验收账号 `123456` 就是这样失效的。
 *
 * 判据是**库名以 `_test` 结尾**（`zafu_pchospital_test`），而不是「run 命令里有没有写
 * test:db」：真正决定数据落到哪里的是 `DATABASE_URL`，不是脚本名。
 */
export function assertDestructiveDbAllowed(): void {
  if (process.env[OVERRIDE] === "1") return;
  const url = process.env.DATABASE_URL;
  const database = url ? basename(new URL(url).pathname) : "";
  if (/_test$/.test(database)) return;
  throw new Error(
    [
      `拒绝在非测试库上跑破坏性集成测试：当前 DATABASE_URL 指向「${database || "未设置"}」。`,
      "这些用例会整表 DELETE（user_identities / password_credentials / member_profiles / audit_logs …），",
      "在开发库上执行的后果是所有账号一起失去登录身份（2026-09-23 发生过）。",
      "请指向独立测试库再跑，例如：",
      '  DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test" pnpm test:db',
      `确实要清空这个库时，显式设置 ${OVERRIDE}=1。`,
    ].join("\n"),
  );
}
