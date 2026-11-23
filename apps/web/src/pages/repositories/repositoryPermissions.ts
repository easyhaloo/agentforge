import type { OrganizationSummary } from "../../shared/api/identity";

export function canManageRepository(organization: OrganizationSummary) {
  return organization.role === "owner" || organization.role === "admin";
}
