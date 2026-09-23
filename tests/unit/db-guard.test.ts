import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertDestructiveDbAllowed,
  assertTestDatabase,
  integrationTestsEnabled,
} from "../integration/db-guard";

/**
 * 破坏性集成测试的闸门（第十一轮验收补）。
 *
 * 起因是一次真实事故：`pnpm test:db` 用 `.env` 的 `DATABASE_URL`（开发库）跑，
 * m0 的清库把开发库里**所有账号的身份**删掉了 —— 登录一律报「QQ 号或密码错误」，
 * 因为查不到那条 QQ 身份。这条测试保证闸门不会再放行同样的组合。
 */

const OVERRIDE = "ALLOW_DESTRUCTIVE_DB_TESTS";
const NON_TEST_OVERRIDE = "ALLOW_NON_TEST_DB";

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

test("全部集成测试的闸门：非测试库拒绝、测试库放行、可用 ALLOW_NON_TEST_DB 显式放行", () => {
  const restore = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", undefined);
  try {
    assert.throws(() => assertTestDatabase(), /拒绝在非测试库上跑集成测试/);
  } finally {
    restore();
  }
  // 注意：withEnv 的第二个参数设的是**清库**那个开关；这里要放行的是通用闸门，
  // 因此显式设 ALLOW_NON_TEST_DB（两个开关刻意分开，见 db-guard.ts 的注释）。
  const restoreAllow = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", undefined);
  process.env[NON_TEST_OVERRIDE] = "1";
  try {
    assert.doesNotThrow(() => assertTestDatabase(), "显式放行后不再拦");
  } finally {
    delete process.env[NON_TEST_OVERRIDE];
    restoreAllow();
  }
  const restoreTest = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital_test", undefined);
  try {
    assert.doesNotThrow(() => assertTestDatabase());
  } finally {
    restoreTest();
  }
});

test("ALLOW_NON_TEST_DB 放不开清库那道更严的闸门", () => {
  const restore = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", undefined);
  process.env[NON_TEST_OVERRIDE] = "1";
  try {
    assert.doesNotThrow(() => assertTestDatabase(), "通用闸门放行");
    assert.throws(
      () => assertDestructiveDbAllowed(),
      /拒绝在非测试库上跑破坏性集成测试/,
      "清库那道闸门必须仍然拦着",
    );
  } finally {
    delete process.env[NON_TEST_OVERRIDE];
    restore();
  }
});

test("未开启集成测试时不抛错（pnpm test 只跑单元与契约）", () => {
  const originalRun = process.env.RUN_DB_TESTS;
  const originalEvent = process.env.npm_lifecycle_event;
  delete process.env.RUN_DB_TESTS;
  delete process.env.npm_lifecycle_event;
  const restore = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", undefined);
  try {
    assert.equal(integrationTestsEnabled(), false, "指向开发库但没开集成测试 → 安静跳过");
  } finally {
    restore();
    if (originalRun === undefined) delete process.env.RUN_DB_TESTS;
    else process.env.RUN_DB_TESTS = originalRun;
    if (originalEvent === undefined) delete process.env.npm_lifecycle_event;
    else process.env.npm_lifecycle_event = originalEvent;
  }
});

test("开启集成测试且指向开发库时，加载阶段就抛错", () => {
  const originalRun = process.env.RUN_DB_TESTS;
  process.env.RUN_DB_TESTS = "1";
  const restore = withEnv("mysql://app_user:x@127.0.0.1:3307/zafu_pchospital", undefined);
  try {
    assert.throws(() => integrationTestsEnabled(), /拒绝在非测试库上跑集成测试/);
  } finally {
    restore();
    if (originalRun === undefined) delete process.env.RUN_DB_TESTS;
    else process.env.RUN_DB_TESTS = originalRun;
  }
});
