import * as XLSX from "xlsx";
import type { GddRow } from "./types";

function safeFilename(name: string): string {
  return name
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

/** Download current GDD rows as an .xlsx workbook. */
export function exportGddToExcel(rows: GddRow[], opts?: { gameName?: string; runId?: string }): void {
  const sheetRows = rows.map((row) => ({
    Section: row.section,
    Parameter: row.parameter,
    Value: row.value,
    Notes: row.notes,
    Source: row.source || "",
    Confidence: row.confidence || "",
    Extra: row.extra ? "yes" : "",
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws["!cols"] = [
    { wch: 28 },
    { wch: 28 },
    { wch: 40 },
    { wch: 36 },
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "GDD");

  const game =
    opts?.gameName?.trim() ||
    rows.find((r) => r.parameter === "Game Name")?.value?.trim() ||
    "gdd";
  const id = opts?.runId ? `_${opts.runId.slice(0, 8)}` : "";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeFilename(game)}${id}_${stamp}.xlsx`;

  XLSX.writeFile(wb, filename);
}
