import type { Item, ResourceColumn } from "./resourceConfigs";

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildResourceCsv(items: Item[], columns: ResourceColumn[]): string {
  const header = columns.map((column) => escapeCsv(column.label)).join(",");
  const rows = items.map((item) =>
    columns.map((column) => escapeCsv(item[column.field])).join(",")
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}
