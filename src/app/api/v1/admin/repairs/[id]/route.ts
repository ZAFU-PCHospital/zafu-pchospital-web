import { repairAdminService } from "@/features/repairs/repair-admin-service";
import { draftInput, requiredString } from "@/features/repairs/repair-http";
import { repairQueryService } from "@/features/repairs/repair-query-service";
import { repairService } from "@/features/repairs/repair-service";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertSameOrigin, authenticateRequest } from "@/lib/auth/request";
import { requirePermission } from "@/lib/auth/permissions";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    const { actor } = await authenticateRequest(request, requestId);
    requirePermission(actor, "repair:review");
    return apiSuccess(await repairQueryService.getById((await params).id, actor), requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * M6「修改异常数据」：请求体 = 草稿字段 + `version` + 必填 `reason`。
 * 允许修改任意状态的记录，但**不改变状态**，改动留痕到时间线与审计。
 */
export async function PATCH(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    const version = Number(body.version);
    return apiSuccess(
      await repairAdminService.updateRecord(
        (await params).id,
        {
          ...draftInput(body),
          version,
          reason: String(body.reason ?? ""),
        },
        actor,
      ),
      requestId,
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

/**
 * M6「软删除违规记录」：请求体 `{ reason: string }`（必填，≤2000 字）。
 * 复用 M2 已有的 `repairService.softDelete`（`repair:delete` 权限 + 时间线 + 审计），
 * 不另写一套删除逻辑 —— 该服务本来就不校验归属，因此成员与管理端共用同一条路径。
 */
export async function DELETE(request: Request, { params }: Context) {
  const requestId = getRequestId(request.headers);
  try {
    assertSameOrigin(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await repairService.softDelete((await params).id, requiredString(body, "reason"), actor);
    return apiSuccess({ deleted: true }, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}
