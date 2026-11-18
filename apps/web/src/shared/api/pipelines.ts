import { request } from "./identity";
import type { components } from "./pipeline-contract";

export type Run = components["schemas"]["Run"];
export type Version = components["schemas"]["Version"];
export type Definition = components["schemas"]["Definition"];
export type Pipeline = components["schemas"]["Pipeline"];
export type Summary = components["schemas"]["Summary"];
const path = (org: string) => `/api/v1/organizations/${encodeURIComponent(org)}/pipelines`;
const item = (org: string, id: string) => `${path(org)}/${encodeURIComponent(id)}`;
export const pipelines = {
  versions: (org: string, id: string) => request<{ items: Version[] }>(`${item(org, id)}/versions`),
  start: (org: string, id: string, number: number, inputs: Record<string, unknown>) => request<Run>(`${item(org, id)}/versions/${number}/runs`, { method: "POST", body: JSON.stringify(inputs) }),
  list: (org: string) => request<{ items: Summary[] }>(path(org)),
  get: (org: string, id: string) => request<Pipeline>(item(org, id)),
  create: (org: string, definition: Definition) => request<Pipeline>(path(org), { method: "POST", body: JSON.stringify(definition) }),
  save: (org: string, p: Pipeline, definition: Definition) => request<Pipeline>(`${item(org, p.id)}/draft`, { method: "PUT", body: JSON.stringify({ revision: p.revision, definition }) }),
  transition: (org: string, p: Pipeline, action: "publish" | "archive") => request<Pipeline>(`${item(org, p.id)}/${action}`, { method: "POST", body: JSON.stringify({ revision: p.revision }) }),
};
