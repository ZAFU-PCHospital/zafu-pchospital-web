import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { getServerEnv } from "@/lib/env";
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

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) {
    throw new Error("密码长度必须为 12–128 个字符");
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
