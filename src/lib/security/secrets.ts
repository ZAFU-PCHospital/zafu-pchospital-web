import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { getServerEnv } from "@/lib/env";
import { isPasswordLengthValid, passwordLengthMessage } from "@/lib/security/password-policy";
import { normalizeInviteCode } from "@/lib/security/normalization";

const scrypt = promisify(scryptCallback);

export function generateInviteCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function digestInviteCode(code: string): Uint8Array<ArrayBuffer> {
  const digest = createHmac("sha256", getServerEnv().INVITE_CODE_PEPPER)
    .update(normalizeInviteCode(code))
    .digest();
  return new Uint8Array(
    digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength),
  );
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestSessionToken(token: string): Uint8Array<ArrayBuffer> {
  return digestSecret(token, getServerEnv().AUTH_SECRET);
}

export function digestLoginThrottleKey(qq: string, ipAddress: string): Uint8Array<ArrayBuffer> {
  return digestSecret(`${qq}:${ipAddress}`, getServerEnv().PII_AUDIT_PEPPER);
}

function digestSecret(value: string, secret: string): Uint8Array<ArrayBuffer> {
  const digest = createHmac("sha256", secret).update(value).digest();
  return new Uint8Array(
    digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength),
  );
}

export async function hashPassword(password: string): Promise<string> {
  // 长度策略只有一个来源（`password-policy.ts`）：表单、服务端校验、这里三处必须一致。
  if (!isPasswordLengthValid(password)) {
    throw new Error(passwordLengthMessage());
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = stored.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(
    password,
    Buffer.from(saltText, "base64url"),
    expected.length,
  )) as Buffer;
  return timingSafeEqual(expected, actual);
}
