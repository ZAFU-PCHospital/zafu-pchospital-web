import { NextResponse } from "next/server";

import { toPublicError } from "@/lib/api/errors";
import type { PaginationMeta } from "@/types/contracts";

export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta: { requestId: string; pagination?: PaginationMeta };
};

export type ApiFailure = {
  success: false;
  error: { code: string; message: string; fieldErrors?: unknown };
  meta: { requestId: string };
};

export function apiSuccess<T>(
  data: T,
  requestId: string,
  options: { status?: number; pagination?: PaginationMeta } = {},
) {
  return NextResponse.json<ApiSuccess<T>>(
    { success: true, data, meta: { requestId, pagination: options.pagination } },
    { status: options.status ?? 200 },
  );
}

export function apiFailure(error: unknown, requestId: string) {
  const publicError = toPublicError(error);
  return NextResponse.json<ApiFailure>(
    {
      success: false,
      error: {
        code: publicError.code,
        message: publicError.message,
        fieldErrors: publicError.fieldErrors,
      },
      meta: { requestId },
    },
    { status: publicError.status },
  );
}
