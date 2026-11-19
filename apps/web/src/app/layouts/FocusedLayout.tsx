import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { APIError, accountAPI, authAPI, type AccountContext } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { flatPaths } from "../../shared/routing";
import { AppAccountContext, type AccountState } from "../account-context";
import { AccountTheme } from "../../features/appearance/AccountTheme";
import { CommandPalette } from "../components/CommandPalette";
import { Topbar } from "../components/Topbar";
import { useNavigateTo } from "../useNavigateTo";
import { useNotify } from "../useNotify";

/**
 * FocusedLayout: For independent pages like Settings and Profile that have their own
 * navigation structure and don't need the main Sidebar. Only includes Topbar with user menu.
 * Based on GitHub's focused page pattern.
 *
 * Handles authentication internally - redirects to login if user is not signed in.
 */
export function FocusedLayout({ fullscreen = false }: { fullscreen?: boolean }) {
  const { t } = useTranslation("app");
  const notify = useNotify();
  const navigateTo = useNavigateTo();
  const location = useLocation();
  const { pathname } = location;
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [accountState, setAccountState] = useState<AccountState>("loading");
  const [commandOpen, setCommandOpen] = useState(false);
  const [accountError, setAccountError] = useState("");

  const loadAccount = async () => {
    setAccountState("loading");
    setAccountError("");
    try {
      const current = await accountAPI.current();
      setAccount(current);
      setAccountState("ready");
    } catch (cause) {
      setAccount(null);
      if (cause instanceof APIError && cause.status === 401) setAccountState("signed-out");
      else {
        setAccountState("unavailable");
        setAccountError(translateError(cause, t, "app:errors.accountLoadFailed"));
      }
    }
  };

  useEffect(() => {
    void loadAccount();
  }, []);

  const signOut = async () => {
    try {
      await authAPI.logout();
      setAccount(null);
      setAccountState("signed-out");
      navigateTo(flatPaths.overview);
      notify(t("app:notify.signedOut"));
    } catch (cause) {
      setAccountError(translateError(cause, t, "app:errors.signOutFailed"));
      setAccountState("unavailable");
    }
  };

  const updateDisplayName = (displayName: string) => {
    setAccount(current => current && { ...current, display_name: displayName });
  };

  const selectedOrganization = account?.organizations[0];

  // Show nothing while loading to avoid flash of content
  if (accountState === "loading") {
    return null;
  }

  // Redirect to login if signed out
  if (accountState === "signed-out") {
    return <Navigate to="/login" state={{ from: pathname }} replace />;
  }

  // Show error state but don't redirect (API temporarily unavailable)
  if (accountState === "unavailable") {
    return (
      <div style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--color-text-secondary)"
      }}>
        <h2 style={{ marginBottom: "12px", color: "var(--color-text-primary)" }}>
          {t("app:errors.authUnavailableTitle")}
        </h2>
        <p>{t("app:errors.authUnavailableBody")}</p>
      </div>
    );
  }

  if (!account) return null;

  return (
    <AppAccountContext.Provider value={{ account, accountState, accountError, reload: loadAccount, updateDisplayName, selectedOrganization }}>
      {fullscreen ? <Outlet /> : <AccountTheme key={account.user_id}>
        <div className="focused-shell">
          <div className="focused-main">
            <Topbar
              focused
              label={pathname.includes("/settings") ? "Settings" : "Profile"}
              onSearch={() => setCommandOpen(true)}
              onNotify={notify}
              onSignOut={() => void signOut()}
            />
            <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
            <div className="focused-content">
              <Outlet />
            </div>
          </div>
        </div>
      </AccountTheme>}
    </AppAccountContext.Provider>
  );
}
