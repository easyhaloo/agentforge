import type { OrganizationSummary } from "../api/identity";
import { CURRENT_ORGANIZATION_HANDLE } from "./paths";

/** The URL handle of an organization: its slug, or its id while the API does not return a slug. */
export function organizationHandle(organization: Pick<OrganizationSummary, "id" | "slug">): string {
  // `current` is reserved for the client-side alias, so an organization that carries it is addressed by its id.
  const slug = organization.slug;
  if (slug && slug.toLowerCase() !== CURRENT_ORGANIZATION_HANDLE) return slug;
  return organization.id;
}

/**
 * Mirrors the server: match `id` exactly first, otherwise `slug` case-insensitively.
 * `current` is a client-side alias for the selected organization and is never a stored handle.
 */
export function findOrganizationByHandle(
  organizations: readonly OrganizationSummary[],
  handle: string,
): OrganizationSummary | undefined {
  if (handle === CURRENT_ORGANIZATION_HANDLE) return undefined;
  const slug = handle.toLowerCase();
  return organizations.find((organization) => organization.id === handle)
    ?? organizations.find((organization) => organization.slug && organization.slug.toLowerCase() === slug);
}
