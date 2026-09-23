import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPasswordLengthValid,
  passwordLengthMessage,
} from "../../src/lib/security/password-policy";
import { hashPassword, verifyPassword } from "../../src/lib/security/secrets";

/**
 * 密码长度策略的回归测试（第十一轮验收）。
 *
 * 这一条来自一次真实事故：策略数字被抄在三处（表单 / 服务端校验 / `hashPassword`），
 * 结果**登录表单**上写着 `minLength={12}`，一个短口令的验收账号在前端就被拦住、
 * 连提交都提交不了。所以这里不只测边界值，还测「数字只有一个来源」。
 */

test("密码长度边界：6 位起、128 位止", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 6);
  assert.equal(PASSWORD_MAX_LENGTH, 128);
  assert.equal(isPasswordLengthValid("12345"), false, "5 位应当被拒");
  assert.equal(isPasswordLengthValid("123456"), true, "6 位应当通过");
  assert.equal(isPasswordLengthValid("a".repeat(128)), true);
  assert.equal(isPasswordLengthValid("a".repeat(129)), false);
  assert.match(passwordLengthMessage(), /6–128/);
});

test("短口令也能落库与校验：hashPassword 不再自带更严的下限", async () => {
  const hash = await hashPassword("123456");
  assert.match(hash, /^scrypt\$/, "哈希格式必须仍是 scrypt$salt$hash");
  assert.equal(await verifyPassword("123456", hash), true);
  assert.equal(await verifyPassword("123457", hash), false);
});

test("长度策略只有一个来源：源码里不得再出现写死的 12 位密码边界", () => {
  // 只扫会参与校验的目录；`password-policy.ts` 自己除外 —— 它就是这条策略的家，
  // 注释里还要引用那次事故（「登录表单上写着 minLength={12}」）。
  // 代码里能提到这个数字的地方一律剥掉注释再判断，免得注释把守卫本身绊倒。
  const roots = ["src/components/auth", "src/features", "src/lib", "src/config"];
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const offenders: string[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      const file = join(root, entry);
      if (file.endsWith("lib/security/password-policy.ts")) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if (/minLength=\{12\}|length < 12\s*\|\||12–128/.test(code)) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "这些文件还写着旧的 12 位策略，应当改用 PASSWORD_MIN_LENGTH");
});
