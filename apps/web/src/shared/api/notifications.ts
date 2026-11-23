import { request } from "./identity";

export type IssueNotification = {
  id: string;
  repository: string;
  issue_number: number;
  issue_title: string;
  reason: "mentioned" | "subscribed" | "author" | "assigned" | "comment";
  unread: boolean;
};

const path = (organizationID: string) => `/api/v1/organizations/${encodeURIComponent(organizationID)}/notifications`;

const watchPath = (organizationID: string, repository: string) =>
  `/api/v1/organizations/${encodeURIComponent(organizationID)}/repositories/${repository.split("/").map(encodeURIComponent).join("/")}/watch`;

export const notificationsAPI = {
  getRepositoryWatch: (organizationID: string, repository: string, signal: AbortSignal) =>
    request<{ watching: boolean }>(watchPath(organizationID, repository), { signal }),
  setRepositoryWatch: (organizationID: string, repository: string, watching: boolean) =>
    request<{ watching: boolean }>(watchPath(organizationID, repository), {
      method: "PATCH", body: JSON.stringify({ watching }),
    }),
  list: (organizationID: string, offset: number, signal: AbortSignal) =>
    request<{ items: IssueNotification[]; total: number; limit: number }>(`${path(organizationID)}?offset=${offset}`, { signal }),
  markRead: (organizationID: string, id: string) =>
    request<{ success: boolean }>(`${path(organizationID)}/${encodeURIComponent(id)}/read`, { method: "PATCH" }),
};
