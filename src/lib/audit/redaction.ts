import { createHmac } from "node:crypto";

const BLOCKED_KEY = /(password|credential|secret|token|code|digest|hash|authorization|cookie)/i;
const QQ_KEY = /(^|_)(qq)($|_)/i;
const PHONE_KEY = /(phone|mobile)/i;

export function maskQq(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.max(3, value.length - 4))}${value.slice(-2)}`;
}

export function maskPhone(value: string): string {
  if (value.length < 7) return "****";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function redactAuditSummary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditSummary);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (BLOCKED_KEY.test(key)) return [];
      if (typeof entry === "string" && PHONE_KEY.test(key)) return [[key, maskPhone(entry)]];
      if (typeof entry === "string" && QQ_KEY.test(key)) return [[key, maskQq(entry)]];
      return [[key, redactAuditSummary(entry)]];
    }),
  );
}

export function digestAuditValue(value: string, pepper: string): Uint8Array<ArrayBuffer> {
  const digest = createHmac("sha256", pepper).update(value).digest();
  return new Uint8Array(
    digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength),
  );
}
