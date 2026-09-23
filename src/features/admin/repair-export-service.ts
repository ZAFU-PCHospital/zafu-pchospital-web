import { repairResultLabels, repairStatusLabels } from "@/config/repairs";
import { listWhere } from "@/features/repairs/repair-query-service";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { toCsv } from "./export-csv";
import { toXlsx } from "./export-xlsx";
import {
  EXPORT_MAX_ROWS,
  type AuthorizedActor,
  type ExportFormat,
  type RepairExportInput,
  type RepairExportResult,
  type RepairExportRow,
  type RepairExportServiceContract,
  type RepairResult,
  type RepairStatus,
} from "@/types/contracts";

/**
 * M6 数据导出（需求 §34 / phase2 §67）。
 *
 * 三条硬规则：
 * 1. **筛选条件与列表完全同源** —— 复用 `listWhere`，保证「筛选后导出」就是所见即所得；
 * 2. **超限拒绝而不是截断** —— `EXPORT_ROW_LIMIT_EXCEEDED` 让管理员去缩小范围，
 *    静默截断会让人误以为拿到了全量数据；
 * 3. **导出必写审计** —— 导出等于把成员姓名等数据带出系统，需求 §45 要求留痕。
 */
export const repairExportService: RepairExportServiceContract = {
  async export(
    input: RepairExportInput,
    format: ExportFormat,
    actor: AuthorizedActor,
  ): Promise<RepairExportResult> {
    requirePermission(actor, "data:export");
    const rows = await loadRows(input, actor);
    const body = format === "CSV" ? toCsv(rows) : await toXlsx(rows);
    const fileName = buildFileName(format);
    await inSerializableTransaction(async (tx) => {
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "repair.exported",
        // 导出没有单一目标实体：用操作者作为 targetId，具体筛选条件放在 after 里，
        // 这样既能按「谁导出了什么」检索，也不会伪造一个不存在的 RepairRecord id。
        targetType: "RepairExport",
        targetId: actor.userId ?? "00000000-0000-0000-0000-000000000000",
        result: "SUCCESS",
        after: { format, rowCount: rows.length, filter: input },
      });
    });
    return {
      format,
      fileName,
      contentType:
        format === "CSV"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
      rowCount: rows.length,
    };
  },
};

/**
 * 读取导出数据。
 *
 * 与列表共用 `listWhere`，但**不受列表分页上限约束**（分页上限 100 行，导出显然更多），
 * 因此这里单独取数并按 `EXPORT_MAX_ROWS` 卡上限。字段裁剪到导出真正需要的列，
 * 不带 reviews / timeline（那些会让导出查询放大十几倍）。
 */
async function loadRows(
  input: RepairExportInput,
  actor: AuthorizedActor,
): Promise<RepairExportRow[]> {
  const where = listWhere({ ...input, page: 1, pageSize: EXPORT_MAX_ROWS }, actor);
  const records = await getDb().repairRecord.findMany({
    where,
    select: {
      id: true,
      repairDate: true,
      durationMinutes: true,
      result: true,
      status: true,
      createdAt: true,
      memberProfile: { select: { realName: true, nickname: true } },
      category: { select: { name: true } },
      photos: { where: { deletedAt: null }, select: { id: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ repairDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    // 多取一行用于判断是否超限，避免额外的 count 查询。
    take: EXPORT_MAX_ROWS + 1,
  });
  if (records.length > EXPORT_MAX_ROWS)
    throw new AppError(
      "EXPORT_ROW_LIMIT_EXCEEDED",
      `导出行数超过上限 ${EXPORT_MAX_ROWS} 条，请缩小筛选范围后重试`,
    );
  return records.map((record) => ({
    repairDate: record.repairDate?.toISOString().slice(0, 10) ?? "",
    memberName: record.memberProfile.nickname || record.memberProfile.realName,
    categoryName: record.category?.name ?? "未分类",
    result: record.result ? repairResultLabels[record.result as RepairResult] : "",
    durationMinutes: record.durationMinutes === null ? "" : String(record.durationMinutes),
    status: repairStatusLabels[record.status as RepairStatus],
    createdAt: formatShanghaiDateTime(record.createdAt),
    repairRecordId: record.id,
    // 需求：图片只输出 URL / 记录 ID，不嵌入表格。
    photoUrls: record.photos.map((photo) => `/api/v1/repair-photos/${photo.id}/content`).join(" "),
  }));
}

function buildFileName(format: ExportFormat): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `repair-records-${stamp}.${format === "CSV" ? "csv" : "xlsx"}`;
}

/** `Asia/Shanghai` 的 `YYYY-MM-DD HH:mm`。导出给人看，因此用本地作息时区而非 UTC。 */
function formatShanghaiDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(value)
    .replace(",", "");
}
