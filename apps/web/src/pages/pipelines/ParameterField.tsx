import { useTranslation } from "react-i18next";
import type { Definition } from "../../shared/api/pipelines";
import { Input, Select } from "../../shared/ui";

export type Parameter = NonNullable<Definition["parameters"]>[number];
export const manualInput = (p: Parameter) => p.required && p.override && p.default === undefined;
export const parameterTypes = ["string", "integer", "number", "boolean", "choice", "branch", "branches", "repository", "secretRef"] satisfies Parameter["type"][];
export const displayValue = (value: Parameter["default"]) => Array.isArray(value) ? value.join(",") : String(value ?? "");

export function parseValue(type: Parameter["type"], text: string): Parameter["default"] {
  if (text === "") return undefined;
  if (type === "number" || type === "integer") return Number(text);
  if (type === "boolean") return text === "true";
  if (type === "branches") return text.split(",").map(s => s.trim());
  return text;
}

export function ParameterField({ parameter, label, value, change, required, disabled }: {
  parameter: Parameter; label: string; value: string; change: (value: string) => void; required?: boolean; disabled?: boolean;
}) {
  const { t } = useTranslation("pipelines");
  const { type, choices } = parameter;
  const field = { label, value, required, disabled, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => change(e.target.value) };
  if (type === "choice" || type === "boolean") return <Select {...field} placeholder={t("unset")} options={(choices ?? ["false", "true"]).map(value => ({ label: value, value }))} />;
  const numeric = type === "number" || type === "integer";
  return <Input {...field} type={numeric ? "number" : "text"} step={type === "integer" ? 1 : "any"}
    min={type === "integer" ? Number.MIN_SAFE_INTEGER : undefined} max={type === "integer" ? Number.MAX_SAFE_INTEGER : undefined}
    hint={type === "branches" ? t("branchesHint") : type === "secretRef" ? t("secretHint") : undefined} />;
}
