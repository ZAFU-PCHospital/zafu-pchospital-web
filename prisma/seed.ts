import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少环境变量：DATABASE_URL");

const url = new URL(databaseUrl);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  timezone: "Z",
  charset: "utf8mb4",
});
async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter });
  const now = new Date();
  try {
    await prisma.role.upsert({
      where: { code: "MEMBER" },
      update: { name: "成员" },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        code: "MEMBER",
        name: "成员",
        createdAt: now,
      },
    });
    await prisma.role.upsert({
      where: { code: "ADMIN" },
      update: { name: "管理员" },
      create: {
        id: "00000000-0000-4000-8000-000000000002",
        code: "ADMIN",
        name: "管理员",
        createdAt: now,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main();
