import { adminCopy, memberRoleLabels, memberStatusLabels } from "@/config/admin";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import { memberDepartmentLabels } from "@/config/member-department";
import { memberRepository } from "@/features/members/member-repository";
import { AppError } from "@/lib/api/errors";
import { appendAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/permissions";
import { inSerializableTransaction } from "@/lib/db/transaction";
import { auditTableQuery } from "@/lib/table/audit-query";
import type { MemberExportServiceContract } from "@/types/contracts";
import { toCsvWith, type ExportColumn } from "./export-csv";
import { toXlsxWith } from "./export-xlsx";

type MemberExportRow = {
  realName: string;
  nickname: string;
  department: string;
  skills: string;
  studentId: string;
  className: string;
  roles: string;
  status: string;
  joinedAt: string;
  approvedRepairCount: string;
  approvedRepairMinutes: string;
  qqMasked: string;
  phoneMasked: string;
  memberProfileId: string;
};

const copy = adminCopy.members;
export const MEMBER_EXPORT_COLUMNS: readonly ExportColumn<MemberExportRow>[] = [
  { key: "realName", header: copy.create.realName },
  { key: "nickname", header: copy.create.nickname },
  { key: "department", header: copy.department },
  { key: "skills", header: copy.table.skills },
  { key: "studentId", header: copy.table.studentId },
  { key: "className", header: copy.table.className },
  { key: "roles", header: copy.table.roles },
  { key: "status", header: copy.table.status },
  { key: "joinedAt", header: copy.table.joinedAt },
  { key: "approvedRepairCount", header: copy.export.columns.approvedRepairCount },
  { key: "approvedRepairMinutes", header: copy.export.columns.approvedRepairMinutes },
  { key: "qqMasked", header: copy.export.columns.qqMasked },
  { key: "phoneMasked", header: copy.export.columns.phoneMasked },
  { key: "memberProfileId", header: copy.export.columns.memberProfileId },
];

/** 沿用列表脱敏边界；全量技能与维修统计来自同一 Repository 映射。 */
export const memberExportService: MemberExportServiceContract = {
  async export(input, format, actor) {
    requirePermission(actor, "member:manage");
    requirePermission(actor, "data:export");
    if (format !== "CSV" && format !== "XLSX")
      throw new AppError("EXPORT_FORMAT_INVALID", "导出格式只支持 csv 或 xlsx");
    const members = await memberRepository.exportRows(input);
    const rows: MemberExportRow[] = members.map((member) => ({
      realName: member.realName,
      nickname: member.nickname ?? "",
      department: memberDepartmentLabels[member.department],
      skills: member.skills.map((skill) => skill.name).join("、"),
      studentId: member.studentId ?? "",
      className: member.className ?? "",
      roles: member.roles.map((role) => memberRoleLabels[role]).join("、"),
      status: memberStatusLabels[member.status],
      joinedAt: formatShanghaiDate(member.joinedAt),
      approvedRepairCount: String(member.approvedRepairCount),
      approvedRepairMinutes: String(member.approvedRepairMinutes),
      qqMasked: member.qqMasked ?? "",
      phoneMasked: member.phoneMasked ?? "",
      memberProfileId: member.id,
    }));
    const body =
      format === "CSV"
        ? toCsvWith(MEMBER_EXPORT_COLUMNS, rows)
        : await toXlsxWith(rows, {
            sheetName: copy.title,
            columns: MEMBER_EXPORT_COLUMNS,
            widths: Object.fromEntries(
              MEMBER_EXPORT_COLUMNS.map(({ key }) => [key, key === "memberProfileId" ? 38 : 20]),
            ),
            textColumns: ["studentId", "qqMasked", "phoneMasked", "memberProfileId"],
          });
    await inSerializableTransaction(async (tx) => {
      await appendAuditLog(tx, {
        actor,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "member.exported",
        targetType: "MemberExport",
        targetId: actor.userId ?? "00000000-0000-0000-0000-000000000000",
        result: "SUCCESS",
        after: { format, rowCount: rows.length, filter: auditTableQuery(input) },
      });
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return {
      format,
      fileName: `members-${stamp}.${format === "CSV" ? "csv" : "xlsx"}`,
      contentType:
        format === "CSV"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
      rowCount: rows.length,
    };
  },
};
