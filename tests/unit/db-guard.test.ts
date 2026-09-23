import assert from "node:assert/strict";
import { test } from "node:test";

import { assertDestructiveDbAllowed } from "../integration/db-guard";

/**
 * 破坏性集成测试的闸门（第十一轮验收补）。
 *
 * 起因是一次真实事故：`pnpm test:db` 用 `.env` 的 `DATABASE_URL`（开发库）跑，
 * m0 的清库把开发库里**所有账号的身份**删掉了 —— 登录一律报「QQ 号或密码错误」，
 * 因为查不到那条 QQ 身份。这条测试保证闸门不会再放行同样的组合。
 */

const OVERRIDE = "ALLOW_DESTRUCTIVE_DB_TESTS";

function withEnv(databaseUrl: string | undefined, override: string | undefined) {
  const originalUrl = process.env.DATABASE_URL;
  const originalOverride = process.env[OVERRIDE];
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrl;
  if (override === undefined) delete process.env[OVERRIDE];
  else process.env[OVERRIDE] = override;
  return () => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalOverride === undefined) delete process.env[OVERRIDE];
    else process.env[OVERRIDE] = originalOverride;
  };
}

test("指向开发库时拒绝执行破坏性测试", () => {
  const restore = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", undefined);
  try {
    assert.throws(() => assertDestructiveDbAllowed(), /拒绝在非测试库上跑破坏性集成测试/);
  } finally {
    restore();
  }
});

test("指向测试库时放行（库名以 _test 结尾）", () => {
  const restore = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital_test", undefined);
  try {
    assert.doesNotThrow(() => assertDestructiveDbAllowed());
  } finally {
    restore();
  }
});

test("显式覆盖时放行，且 DATABASE_URL 缺失时也拒绝", () => {
  const restoreOverride = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", "1");
  try {
    assert.doesNotThrow(() => assertDestructiveDbAllowed(), "显式覆盖应当放行");
  } finally {
    restoreOverride();
  }
  const restoreMissing = withEnv(undefined, undefined);
  try {
    assert.throws(() => assertDestructiveDbAllowed(), /未设置/);
  } finally {
    restoreMissing();
  }
});
