import { AppError } from "@/lib/api/errors";

const REQUIRED_SERVER_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "INVITE_CODE_PEPPER",
  "PII_AUDIT_PEPPER",
] as const;

export type ServerEnv = Record<(typeof REQUIRED_SERVER_ENV)[number], string> & {
  APP_BASE_URL: string;
};

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const missing = REQUIRED_SERVER_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new AppError("INTERNAL_ERROR", `缺少服务端环境变量：${missing.join(", ")}`, {
      status: 500,
    });
  }

  cached = {
    DATABASE_URL: process.env.DATABASE_URL!,
    AUTH_SECRET: process.env.AUTH_SECRET!,
    INVITE_CODE_PEPPER: process.env.INVITE_CODE_PEPPER!,
    PII_AUDIT_PEPPER: process.env.PII_AUDIT_PEPPER!,
    APP_BASE_URL: process.env.APP_BASE_URL ?? "http://localhost:3000",
  };
  return cached;
}

export function resetServerEnvForTests(): void {
  cached = undefined;
}
