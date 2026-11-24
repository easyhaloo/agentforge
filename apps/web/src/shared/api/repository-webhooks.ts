import { request } from "./identity";

export type WebhookEvent = "issues" | "issue_comment";
export type RepositoryWebhook = { id: string; url: string; events: WebhookEvent[]; active: boolean };
export type WebhookDelivery = { id: string; event: WebhookEvent; status: string; http_status?: number; created_at: string; delivered_at?: string };
export type WebhookUpdate = Omit<RepositoryWebhook, "id"> & { secret?: string };

export function repositoryWebhooksAPI(organization: string, slug: string) {
  const path = `/api/v1/organizations/${encodeURIComponent(organization)}/repositories/${slug.split("/").map(encodeURIComponent).join("/")}/webhooks`;
  return {
    list: (signal?: AbortSignal) => request<{ webhooks: RepositoryWebhook[] }>(path, { signal }).then(result => result.webhooks),
    save: (id: string | undefined, data: WebhookUpdate) => request<RepositoryWebhook>(id ? `${path}/${encodeURIComponent(id)}` : path, {
      method: id ? "PATCH" : "POST", body: JSON.stringify(data),
    }),
    remove: (id: string) => request<void>(`${path}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deliveries: (id: string) => request<{ deliveries: WebhookDelivery[] }>(`${path}/${encodeURIComponent(id)}/deliveries`).then(result => result.deliveries),
  };
}
