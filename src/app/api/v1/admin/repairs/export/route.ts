import { repairExportService } from "@/features/admin/repair-export-service";
import { repairListInput } from "@/features/repairs/repair-http";
import { AppError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { authenticateRequest } from "@/lib/auth/request";
import { ExportFormat } from "@/types/contracts";
import type { ExportFormat as Format } from "@/types/contracts";
export const runtime = "nodejs";
/**
 * M6 数据导出：`GET /api/v1/admin/repairs/export?format=csv|xlsx&<与列表相同的筛选参数>`。
 *
 * 走 `data:export` 权限（ADMIN 独占），筛选条件与 `/api/v1/admin/repairs` 完全同源。
 * 这是本站唯一的下载型响应，因此显式设置 `Content-Disposition` 与 `no-store`。
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    const params = new URL(request.url).searchParams;
    const raw = (params.get("format") ?? "CSV").toUpperCase();
    if (!(ExportFormat as readonly string[]).includes(raw))
      throw new AppError("EXPORT_FORMAT_INVALID", "导出格式只支持 csv 或 xlsx");
    // 分页参数对导出没有意义：用筛选解析器但固定 1/1，避免 pageSize 上限干扰。
    const filter = repairListInput(params, 1, 1);
    const result = await repairExportService.export(
      {
        memberId: filter.memberId,
        categoryId: filter.categoryId,
        status: filter.status,
        result: filter.result,
        repairDateFrom: filter.repairDateFrom,
        repairDateTo: filter.repairDateTo,
        isDifficult: filter.isDifficult,
        isTypical: filter.isTypical,
        query: filter.query,
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
