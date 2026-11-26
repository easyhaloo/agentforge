import { createContext, useContext } from "react";
import type { AccountContext, OrganizationSummary } from "../shared/api/identity";
import { usePersistentState } from "../shared/hooks/usePersistentState";

export type AccountState = "loading" | "ready" | "signed-out" | "unavailable";

/** Account and organization state, loaded once by the root layout and shared with the routes under it. */
export type AppAccount = {
  account: AccountContext | null;
  accountState: AccountState;
  accountError: string;
  reload: () => Promise<void>;
  updateDisplayName?: (displayName: string) => void;
  selectedOrganization: OrganizationSummary | undefined;
  selectOrganization?: (id: string) => void;
};

// Safe default: components such as the command palette must render without a provider
// (the shared UI e2e harness mounts it with only a router). There the `current` handle is used.
const withoutProvider: AppAccount = {
  account: null,
  accountState: "loading",
  accountError: "",
  reload: async () => {},
  selectedOrganization: undefined,
};

export const AppAccountContext = createContext<AppAccount>(withoutProvider);

export const useAppAccount = () => useContext(AppAccountContext);

export function useSelectedOrganization(account: AccountContext | null) {
  const [id, selectOrganization] = usePersistentState(`agentforge-organization:${account?.user_id ?? ""}`, "");
  const organizations = account?.organizations;
  // Default to the first active organization: /me now also returns suspended
  // and pending-deletion organizations, which are read-only or locked.
  const preferred = organizations?.find(org => org.id === id)
    ?? organizations?.find(org => (org.status ?? "active") === "active")
    ?? organizations?.[0];
  return [preferred, selectOrganization] as const;
}
