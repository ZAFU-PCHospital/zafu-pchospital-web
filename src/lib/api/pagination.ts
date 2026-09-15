import { AppError } from "@/lib/api/errors";
import type { PaginationInput, PaginationMeta } from "@/types/contracts";

export function parsePagination(params: URLSearchParams): PaginationInput {
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new AppError("VALIDATION_FAILED", "分页参数无效");
  }
  return { page, pageSize };
}

export function paginationMeta(input: PaginationInput, total: number): PaginationMeta {
  return { ...input, total, totalPages: Math.ceil(total / input.pageSize) };
}
