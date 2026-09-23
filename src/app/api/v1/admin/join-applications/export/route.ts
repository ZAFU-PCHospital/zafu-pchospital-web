import { queryOneOf, queryString } from "@/features/admin/admin-http";
import { joinApplicationExportService } from "@/features/admin/join-application-export-service";
import { AppError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
import { ExportFormat, JoinApplicationStatus, ProvisionStatus } from "@/types/contracts";
import type { ExportFormat as Format } from "@/types/contracts";

export const runtime = "nodejs";

/**
 * M6 批次 2：报名数据导出（需求 §4.4）。
 *
 * 筛选参数与 `GET /api/v1/admin/join-applications` 完全同源（复用 `joinApplicationListWhere`）。
 * 这条路径的产物带 QQ 与手机号明文，因此走 `data:export` 权限并写独立审计动作
 * `join.applications.exported`，不与维修导出混在一起。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const raw = (params.get("format") ?? "CSV").toUpperCase();
    if (!(ExportFormat as readonly string[]).includes(raw)) {
      throw new AppError("EXPORT_FORMAT_INVALID", "导出格式只支持 csv 或 xlsx");
    }
    const result = await joinApplicationExportService.export(
      {
        status: queryOneOf(params, "status", JoinApplicationStatus),
        provisionStatus: queryOneOf(params, "provisionStatus", ProvisionStatus),
        submittedFrom: queryString(params, "submittedFrom"),
        submittedTo: queryString(params, "submittedTo"),
        query: queryString(params, "query"),
      },
      raw as Format,
      actor,
    );
    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        // filename* 用 RFC 5987 编码，文件名里的中文才能在浏览器里正确落盘。
        "Content-Disposition": `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        "Content-Length": String(result.body.byteLength),
        "Cache-Control": "private, no-store",
        "X-Export-Row-Count": String(result.rowCount),
      },
    });
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
