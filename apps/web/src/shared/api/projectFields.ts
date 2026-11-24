import { request } from "./identity";

export const projectFieldTypes = ["text", "number", "date", "single_select", "iteration"] as const;
export type ProjectFieldType = typeof projectFieldTypes[number];
export type ProjectFieldOption = { id: string; name: string; start_date?: string; end_date?: string };
type ProjectFieldOptionInput = Omit<ProjectFieldOption, "id"> & { id?: string };
export type ProjectField = { id: string; name: string; type: ProjectFieldType; options: ProjectFieldOption[] };
export type ProjectFieldDefinitionInput = {
  project_version: number;
  name: string;
  type: ProjectFieldType;
  options: ProjectFieldOptionInput[];
};
export type ProjectFieldDefinitions = { project_version: number; fields: ProjectField[] };
export type ProjectFieldValue = string | number;
export type ProjectItemFieldValues = { item_version: number; values: Record<string, ProjectFieldValue> };

function projectURL(orgID: string, number: number) {
  return `/api/v1/organizations/${encodeURIComponent(orgID)}/issue-projects/${encodeURIComponent(number)}`;
}

function fieldValuesURL(orgID: string, number: number, itemID: string) {
  return `${projectURL(orgID, number)}/items/${encodeURIComponent(itemID)}/field-values`;
}

export const projectFieldsAPI = {
  list: (orgID: string, number: number, signal?: AbortSignal) =>
    request<ProjectFieldDefinitions>(`${projectURL(orgID, number)}/fields`, { signal }),
  create: (orgID: string, number: number, input: ProjectFieldDefinitionInput) =>
    request<ProjectFieldDefinitions>(`${projectURL(orgID, number)}/fields`, { method: "POST", body: JSON.stringify(input) }),
  update: (orgID: string, number: number, fieldID: string, input: ProjectFieldDefinitionInput) =>
    request<ProjectFieldDefinitions>(`${projectURL(orgID, number)}/fields/${encodeURIComponent(fieldID)}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (orgID: string, number: number, fieldID: string, version: number) =>
    request<ProjectFieldDefinitions>(`${projectURL(orgID, number)}/fields/${encodeURIComponent(fieldID)}?version=${version}`, { method: "DELETE" }),
  values: (orgID: string, number: number, itemID: string, signal?: AbortSignal) =>
    request<ProjectItemFieldValues>(fieldValuesURL(orgID, number, itemID), { signal }),
  setValue: (orgID: string, number: number, itemID: string, fieldID: string, itemVersion: number, value: ProjectFieldValue | null) =>
    request<ProjectItemFieldValues>(`${fieldValuesURL(orgID, number, itemID)}/${encodeURIComponent(fieldID)}`, {
      method: "PUT", body: JSON.stringify({ item_version: itemVersion, value }),
    }),
};
