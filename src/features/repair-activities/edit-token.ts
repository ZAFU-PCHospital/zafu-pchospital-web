import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "@/lib/api/errors";
import { getServerEnv } from "@/lib/env";

const EDIT_TOKEN_TTL_MS = 10 * 60 * 1000;

type EditTokenPayload = {
  registrationId: string;
  activityId: string;
  exp: number;
};

/**
 * lookup 签发的短期查询 / 改类型 / 取消 token（HMAC-SHA256，约 10 分钟）。
 * 格式：`base64url(payloadJson).base64url(sig)`
 */
export function issueRegistrationEditToken(
  registrationId: string,
  activityId: string,
  now = new Date(),
): { editToken: string; expiresAt: string } {
  const exp = now.getTime() + EDIT_TOKEN_TTL_MS;
  const payload: EditTokenPayload = { registrationId, activityId, exp };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = sign(body);
  return {
    editToken: `${body}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyRegistrationEditToken(
  token: string,
  expected: { registrationId: string; activityId: string },
  now = new Date(),
): void {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
  }
  const [body, sig] = parts;
  const expectedSig = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
  }
  let payload: EditTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as EditTokenPayload;
  } catch {
    throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
  }
  if (
    payload.registrationId !== expected.registrationId ||
    payload.activityId !== expected.activityId
  ) {
    throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
  }
  if (typeof payload.exp !== "number" || now.getTime() > payload.exp) {
    throw new AppError("ACTIVITY_EDIT_TOKEN_INVALID", "查询凭证无效或已过期，请重新查询");
  }
}

function sign(body: string): string {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(body).digest("base64url");
}
