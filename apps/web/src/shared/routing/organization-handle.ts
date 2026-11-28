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
 * The display label for a repository owner: the organization name when the slug prefix is the org id
 * (personal workspaces included — their name is already "DisplayName's Workspace").
 */
export function ownerDisplayLabel(owner: string, organization: Pick<OrganizationSummary, "id" | "name">): string {
  return owner === organization.id ? organization.name : owner;
}

/** The repository slug shown to users: `OwnerLabel/name`, or the whole slug when it has no owner prefix. */
export function repositoryDisplaySlug(slug: string, organization: Pick<OrganizationSummary, "id" | "name">): string {
  const separator = slug.indexOf("/");
  if (separator < 0) return slug;
  const owner = slug.slice(0, separator);
  return `${ownerDisplayLabel(owner, organization)}/${slug.slice(separator + 1)}`;
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
