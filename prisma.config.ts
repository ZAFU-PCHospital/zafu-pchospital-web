import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Generation and static builds do not open a connection. Runtime access validates the real value.
    url: process.env.DATABASE_URL ?? "mysql://build-only:build-only@127.0.0.1:3306/build_only",
  },
});
