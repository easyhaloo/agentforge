import { useEffect, useState } from "react";
import { Outlet, useLocation, useMatches, useNavigate, useParams } from "react-router-dom";
import { APIError, accountAPI, authAPI, type AccountContext } from "../shared/api/identity";
import { CURRENT_ORGANIZATION_HANDLE, findOrganizationByHandle, flatPaths, organizationHandle, withOrganizationHandle } from "../shared/routing";
import { AppAccountContext, type AccountState } from "./account-context";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { PageHeader } from "./components/PageHeader";
import { CommandPalette } from "./components/CommandPalette";
import { navigationItemFor, routeLabel } from "./navigation";
import { useNotify } from "./useNotify";

/** Root layout: loads the account once and renders the shell around the page the URL selects. */
function App() {
  const [commandOpen, setCommandOpen] = useState(false);
  const notify = useNotify();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { org: urlHandle } = useParams();
  const matches = useMatches();
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [accountState, setAccountState] = useState<AccountState>("loading");
  const [accountError, setAccountError] = useState("");
  const [selectedOrganizationID, setSelectedOrganizationID] = useState("");

  const loadAccount = async () => {
    setAccountState("loading");
    setAccountError("");
    try {
      const current = await accountAPI.current();
      setAccount(current);
      setSelectedOrganizationID((selected) => current.organizations.some((item) => item.id === selected) ? selected : current.organizations[0]?.id ?? "");
      setAccountState("ready");
    } catch (cause) {
      setAccount(null);
      if (cause instanceof APIError && cause.status === 401) setAccountState("signed-out");
      else { setAccountState("unavailable"); setAccountError(cause instanceof Error ? cause.message : "Unable to load account context"); }
    }
  };

  useEffect(() => { void loadAccount(); }, []);

  // Inside /orgs/:org the URL decides which organization is selected; elsewhere the last selection does.
  const urlOrganization = urlHandle && account ? findOrganizationByHandle(account.organizations, urlHandle) : undefined;
  const selectedOrganization = urlOrganization ?? account?.organizations.find((item) => item.id === selectedOrganizationID);
  // Visiting an organization's URL also selects it, so the choice survives leaving /orgs/:org.
  useEffect(() => { if (urlOrganization) setSelectedOrganizationID(urlOrganization.id); }, [urlOrganization?.id]);
  // Links keep the handle form the visitor used (id or slug), so the open page's sidebar item stays current.
  const linkHandle = (urlOrganization && urlHandle) || (selectedOrganization ? organizationHandle(selectedOrganization) : CURRENT_ORGANIZATION_HANDLE);

  const selectOrganization = (organizationID: string) => {
    setSelectedOrganizationID(organizationID);
    const next = account?.organizations.find((item) => item.id === organizationID);
    if (next && urlHandle) navigate(withOrganizationHandle(pathname, organizationHandle(next)));
  };

  const signOut = async () => {
    try {
      await authAPI.logout();
      setAccount(null);
      setSelectedOrganizationID("");
      setAccountState("signed-out");
      navigate(flatPaths.overview);
      notify("You have signed out.");
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "Unable to sign out");
      setAccountState("unavailable");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const label = routeLabel(matches.at(-1)?.handle);
  const item = navigationItemFor(label);

  return (
    <AppAccountContext.Provider value={{ account, accountState, accountError, reload: loadAccount, selectedOrganization, selectOrganization, signOut }}>
      <div className="shell">
        <Sidebar account={account} selectedOrganization={selectedOrganization} linkHandle={linkHandle} onSelectOrganization={selectOrganization} onSignOut={() => void signOut()} />
        <main className="main">
          <Topbar label={label} onSearch={() => setCommandOpen(true)} onNotify={notify} />
          <div className="content">
            <PageHeader
              label={label}
              description={item?.description}
              onRefresh={item ? () => urlHandle ? void loadAccount() : notify("Demo data refreshed.") : undefined}
            />
            <Outlet />
            <footer>
              <span>AgentForge Prototype <b>v0.1.0</b></span>
              <span><i className="live-dot" /> All systems operational <span className="footer-sep">·</span> Mock environment</span>
            </footer>
          </div>
        </main>
        <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      </div>
    </AppAccountContext.Provider>
  );
}

export default App;
