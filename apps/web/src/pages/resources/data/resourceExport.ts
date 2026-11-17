import type { ResourceColumn } from "./resourceConfigs";
import type { ResourceRow } from "./resourceRecords";

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildResourceCsv(items: ResourceRow[], columns: ResourceColumn[]): string {
  const header = columns.map((column) => escapeCsv(column.label)).join(",");
  const rows = items.map((item) =>
    columns.map((column) => escapeCsv(item[column.field])).join(",")
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}
