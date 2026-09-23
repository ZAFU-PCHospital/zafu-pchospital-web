import ExcelJS from "exceljs";

import { EXPORT_COLUMNS, renderCells, type ExportColumn } from "./export-csv";
import type { RepairExportRow } from "@/types/contracts";

/** 各列宽度（字符数）。中文列给宽一些，避免打开就是 `####`。 */
const COLUMN_WIDTHS: Record<(typeof EXPORT_COLUMNS)[number]["key"], number> = {
  repairDate: 14,
  memberName: 16,
  categoryName: 18,
  result: 12,
  durationMinutes: 12,
  status: 12,
  createdAt: 20,
  repairRecordId: 38,
  photoUrls: 60,
};

/**
 * 生成真正的 `.xlsx` 字节流（exceljs）。
 *
 * 为什么用库而不是手写 ZIP：`.xlsx` 是 ZIP + SpreadsheetML，手写要自己维护
 * CRC-32 与 ZIP 目录结构；本项目已批准引入 `exceljs`（见 `docs/M6-交付报告.md`
 * 的依赖说明），因此这里只负责把行数据映射成工作表。
 *
 * 两个关键取舍：
 * - **不嵌入图片**：需求明确「图片只输出 URL / Record ID」，否则一份导出会膨胀到几十 MB；
 * - **文本单元格**：记录 ID、学号、QQ 这类值设置 `numFmt = "@"`，避免 Excel
 *   按数值 / 科学计数法处理（长数字会被改写并丢精度）。
 */
export type XlsxLayout<T> = {
  sheetName: string;
  columns: readonly ExportColumn<T>[];
  widths: Record<string, number>;
  /** 必须按文本写入的列，例如记录 ID、QQ 号。 */
  textColumns: readonly string[];
};

export async function toXlsxWith<T>(
  rows: readonly T[],
  layout: XlsxLayout<T>,
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "浙江农林大学电脑医院";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(layout.sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = layout.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: layout.widths[column.key],
  }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  for (const row of rows) sheet.addRow(renderCells(layout.columns, row));
  for (const column of layout.textColumns) sheet.getColumn(column).numFmt = "@";
  const buffer = await workbook.xlsx.writeBuffer();
  // `Uint8Array.from` 返回 `Uint8Array<ArrayBuffer>`，可直接作为 `Response` 的 body。
  return Uint8Array.from(new Uint8Array(buffer as ArrayBufferLike));
}

export async function toXlsx(
  rows: readonly RepairExportRow[],
  sheetName = "维修记录",
): Promise<Uint8Array<ArrayBuffer>> {
  return toXlsxWith(rows, {
    sheetName,
    columns: EXPORT_COLUMNS,
    widths: COLUMN_WIDTHS,
    // 文本列：记录 ID 与照片 URL 一律按文本写入，避免被 Excel 重写成数值或链接。
    textColumns: ["repairRecordId", "photoUrls"],
  });
}
