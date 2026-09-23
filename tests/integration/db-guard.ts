import { basename } from "node:path";

/** 允许「对着非测试库跑集成测试」的显式开关（默认关闭）。 */
const ALLOW_NON_TEST_DB = "ALLOW_NON_TEST_DB";
/** 允许「整表清空」这类破坏性用例的显式开关（比上面更危险，所以单独一个）。 */
const ALLOW_DESTRUCTIVE = "ALLOW_DESTRUCTIVE_DB_TESTS";

function databaseName(): string {
  const url = process.env.DATABASE_URL;
  return url ? basename(new URL(url).pathname) : "";
}

/**
 * 集成测试的统一闸门：**只允许对着独立测试库跑**。
 *
 * 为什么需要它：`pnpm test:db` 与直接 `tsx --test tests/integration/**` 用的都是
 * `.env` 里的 `DATABASE_URL`，而本地 `.env` 指的是**开发库**。这些用例不是只读的 ——
 * 它们按前缀建夹具也按前缀删夹具，其中 `m0-database.test.ts` 更是整表清空
 * （`user_identities` / `password_credentials` / `member_profiles` / `audit_logs` …）。
 * 实际发生过两次：
 *
 * 1. 跑了一次 `pnpm test:db` → 开发库**所有账号一起失去登录身份**（登录报
 *    「QQ 号或密码错误」，因为查不到那条 QQ 身份），而 `users` 因为
 *    `public_content_settings.updated_by_user_id` 的 RESTRICT 外键没被删掉，
 *    留下 254 个「有用户、没身份」的孤儿；验收账号 `123456` 就是这样失效的。
 * 2. 推导测试库 URL 的 `sed` 在 `.env` 多了 `?allowPublicKeyRetrieval=true` 之后悄悄
 *    匹配不上，40 秒里往开发库写进 49 个夹具档案与 2 条维修记录
 *    （那次靠下面第二道闸门挡住了清库，没有重演第一次）。
 *
 * 判据是**库名以 `_test` 结尾**（`zafu_pchospital_test`），而不是「命令里有没有写
 * test:db」：真正决定数据落到哪里的是 `DATABASE_URL`，不是脚本名。
 *
 * 两道闸门刻意分开：
 * - {@link integrationTestsEnabled} 管全部集成测试（写夹具就有污染）；
 * - {@link assertDestructiveDbAllowed} 只管整表清空的那几个用例。
 * 于是即使有人为了对着 staging 库跑而设了 `ALLOW_NON_TEST_DB=1`，
 * 清库那一步仍然会停下来 —— 危险等级不同，开关就该不同。
 */

/**
 * 集成测试是否应当运行。
 *
 * 未开启（例如 `pnpm test` 只跑单元与契约）时返回 `false`：各文件据此走 `test.skip`，
 * **不抛错**，那份跑法要保持安静。
 * 开启了却指向非测试库时**直接抛错**：宁可整轮红掉，也不要往开发库里写。
 */
export function integrationTestsEnabled(): boolean {
  const enabled = process.env.RUN_DB_TESTS === "1" || process.env.npm_lifecycle_event === "test:db";
  if (!enabled) return false;
  assertTestDatabase();
  return true;
}

/** 全部集成测试的入口闸门。 */
export function assertTestDatabase(): void {
  const database = databaseName();
  if (/_test$/.test(database)) return;
  if (process.env[ALLOW_NON_TEST_DB] === "1") return;
  throw new Error(
    [
      `拒绝在非测试库上跑集成测试：当前 DATABASE_URL 指向「${database || "未设置"}」。`,
      "这些用例会按前缀建夹具、删夹具，m0 还会整表清空（身份 / 口令 / 档案 / 审计），",
      "在开发库上执行的后果是所有账号一起失去登录身份（2026-09-23 发生过两次）。",
      "请指向独立测试库再跑，例如：",
      '  DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test" pnpm test:db',
      `确实要对着这个库跑，请显式设置 ${ALLOW_NON_TEST_DB}=1。`,
    ].join("\n"),
  );
}

/** 破坏性（整表清空）用例的入口闸门，只由 `m0-database.test.ts` 调用。 */
export function assertDestructiveDbAllowed(): void {
  if (process.env[ALLOW_DESTRUCTIVE] === "1") return;
  const database = databaseName();
  if (/_test$/.test(database)) return;
  throw new Error(
    [
      `拒绝在非测试库上跑破坏性集成测试：当前 DATABASE_URL 指向「${database || "未设置"}」。`,
      "这些用例会整表 DELETE（user_identities / password_credentials / member_profiles / audit_logs …），",
      "在开发库上执行的后果是所有账号一起失去登录身份（2026-09-23 发生过）。",
      "请指向独立测试库再跑，例如：",
      '  DATABASE_URL="mysql://app_user:change-me@127.0.0.1:3307/zafu_pchospital_test" pnpm test:db',
      `确实要清空这个库时，显式设置 ${ALLOW_DESTRUCTIVE}=1。`,
    ].join("\n"),
  );
}
