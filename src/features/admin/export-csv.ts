import type { RepairExportRow } from "@/types/contracts";

/**
 * 一列的定义。列顺序即表头顺序，CSV 与 XLSX 共用同一份列模型。
 *
 * 泛型化是为了让第二条导出路径（报名数据，`JoinApplicationExportRow`）复用
 * 同一套转义、BOM、公式注入防护与文本单元格处理，而不是复制一份 CSV 写入器。
 */
export type ExportColumn<T> = { key: keyof T & string; header: string };

/** 导出表头。顺序与 `RepairExportRow` 的键一一对应，CSV 与 XLSX 共用。 */
export const EXPORT_COLUMNS: readonly ExportColumn<RepairExportRow>[] = [
  { key: "repairDate", header: "维修日期" },
  { key: "memberName", header: "维修成员" },
  { key: "categoryName", header: "故障分类" },
  { key: "result", header: "维修结果" },
  { key: "durationMinutes", header: "维修时长" },
  { key: "status", header: "审核状态" },
  { key: "createdAt", header: "创建时间" },
  { key: "repairRecordId", header: "记录 ID" },
  { key: "photoUrls", header: "维修照片" },
];

/** 把一行渲染成与表头同序的字符串数组。 */
export function renderCells<T>(columns: readonly ExportColumn<T>[], row: T): string[] {
  return columns.map((column) => String(row[column.key]));
}

/** 把一行渲染成与表头同序的字符串数组。 */
export function toCells(row: RepairExportRow): string[] {
  return renderCells(EXPORT_COLUMNS, row);
}

/**
 * 单元格里的 CSV 注入防护。
 *
 * Excel 会把 `=`、`+`、`-`、`@` 开头的文本当公式执行（DDE / HYPERLINK 一类），
 * 汇总页里的文本最终可能包含用户输入，因此统一前置一个单引号强制为文本。
 * 这是导出功能的标准做法，不影响在 Excel 中的可读性（`'` 不会显示）。
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 字段转义：含分隔符、引号、换行时必须整体加引号，内部引号翻倍。 */
export function escapeCsvField(value: string): string {
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * 生成 CSV 字节流。
 *
 * - 行分隔符用 CRLF（RFC 4180）；
 * - 前置 UTF-8 BOM：中文 Windows 的 Excel 默认按 ANSI 解析 `.csv`，
 *   没有 BOM 会直接糊码，这是「导出的 CSV 打开是乱码」的根因。
 */
export function toCsvWith<T>(
  columns: readonly ExportColumn<T>[],
  rows: readonly T[],
): Uint8Array<ArrayBuffer> {
  const lines = [
    columns.map((column) => escapeCsvField(column.header)).join(","),
    ...rows.map((row) =>
      renderCells(columns, row)
        .map((cell) => escapeCsvField(cell))
        .join(","),
    ),
  ];
  // `TextEncoder` 直接产出 `Uint8Array<ArrayBuffer>`，可直接作为 `Response` 的 body；
  // 用 `Buffer.from` 会得到 `Uint8Array<ArrayBufferLike>`，类型上不能当 `BodyInit`。
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

export function toCsv(rows: readonly RepairExportRow[]): Uint8Array<ArrayBuffer> {
  return toCsvWith(EXPORT_COLUMNS, rows);
}
