import { createContext, useContext } from "react";
import type { AccountContext, OrganizationSummary } from "../shared/api/identity";

export type AccountState = "loading" | "ready" | "signed-out" | "unavailable";

/** Account and organization state, loaded once by the root layout and shared with the routes under it. */
export type AppAccount = {
  account: AccountContext | null;
  accountState: AccountState;
  accountError: string;
  reload: () => Promise<void>;
  selectedOrganization: OrganizationSummary | undefined;
  selectOrganization: (organizationID: string) => void;
  signOut: () => Promise<void>;
};

// Safe default: components such as the command palette must render without a provider
// (the shared UI e2e harness mounts it with only a router). There the `current` handle is used.
const withoutProvider: AppAccount = {
  account: null,
  accountState: "loading",
  accountError: "",
  reload: async () => {},
  selectedOrganization: undefined,
  selectOrganization: () => {},
  signOut: async () => {},
};

export const AppAccountContext = createContext<AppAccount>(withoutProvider);

export const useAppAccount = () => useContext(AppAccountContext);
