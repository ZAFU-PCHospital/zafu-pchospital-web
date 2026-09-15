import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/client";

const RETRYABLE_TRANSACTION_CODES = new Set(["P2034"]);

export async function inSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await getDb().$transaction(operation, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : null;
      if (
        attempt >= maxAttempts ||
        typeof code !== "string" ||
        !RETRYABLE_TRANSACTION_CODES.has(code)
      ) {
        throw error;
      }
    }
  }
}
