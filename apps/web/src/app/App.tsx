import { useEffect, useState } from "react";
import { DeliveryFlow } from "../features/delivery";
import { ResourceWorkspacePage } from "../pages/resources";
import { OverviewPage } from "../pages/overview";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { PageHeader } from "./components/PageHeader";
import { CommandPalette } from "./components/CommandPalette";
import { UIShowcasePage } from "../pages/ui-showcase";
import { useNotification } from "../shared/ui";
import { OrganizationManagementPage } from "../pages/organization/OrganizationManagementPage";
import { ChangesetsPage } from "../pages/changesets/ChangesetsPage";
import { APIError, accountAPI, authAPI, type AccountContext } from "../shared/api/identity";

function App() {
  const [active, setActive] = useState("Overview");
  const [commandOpen, setCommandOpen] = useState(false);
  const { notify: showNotification } = useNotification();
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [accountState, setAccountState] = useState<"loading" | "ready" | "signed-out" | "unavailable">("loading");
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

  const signOut = async () => {
    try {
      await authAPI.logout();
      setAccount(null);
      setSelectedOrganizationID("");
      setAccountState("signed-out");
      setActive("Overview");
      notify("You have signed out.");
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "Unable to sign out");
      setAccountState("unavailable");
    }
  };

  const notify = (message: string) => {
    showNotification({ status: "success", message, duration: 2600 });
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

  return (
    <div className="shell">
      <Sidebar active={active} onNavigate={setActive} account={account} selectedOrganizationID={selectedOrganizationID} onSelectOrganization={setSelectedOrganizationID} onSignOut={() => void signOut()} />
      <main className="main">
        <Topbar active={active} onSearch={() => setCommandOpen(true)} onNotify={notify} />
        <div className="content">
          <PageHeader
            active={active}
            onRefresh={() => active === "Organization" || active === "Changesets" ? void loadAccount() : notify("Demo data refreshed.")}
          />
          {active === "UI Components" ? (
            <UIShowcasePage />
          ) : active === "Organization" ? (
            accountState === "loading" ? <section className="card org-auth-state">Loading authenticated account and organizations…</section> : accountState === "signed-out" ? <section className="card org-auth-state"><h2>Sign in to manage your organization</h2><p>Organization settings require an authenticated AgentForge session.</p><a className="button primary" href="/auth/oidc/login">Continue with SSO</a><button className="button secondary" onClick={() => void loadAccount()}>Retry</button></section> : accountState === "unavailable" ? <section className="card org-auth-state"><h2>Organization service unavailable</h2><p>{accountError}</p><button className="button secondary" onClick={() => void loadAccount()}>Retry</button></section> : account?.organizations.find((organization) => organization.id === selectedOrganizationID) ? <OrganizationManagementPage key={selectedOrganizationID} organization={account.organizations.find((organization) => organization.id === selectedOrganizationID)!} onNotify={notify} /> : <section className="card org-auth-state"><h2>No active organization</h2><p>This account has no active organization membership. Ask an organization owner for an invitation.</p></section>
          ) : active === "Changesets" ? (
            accountState === "loading" ? <section className="card org-auth-state">Loading authenticated account and organizations…</section> : accountState === "signed-out" ? <section className="card org-auth-state"><h2>Sign in to view changesets</h2><p>Changesets are scoped to an authenticated organization.</p><a className="button primary" href="/auth/oidc/login">Continue with SSO</a></section> : accountState === "unavailable" ? <section className="card org-auth-state"><h2>Changeset service unavailable</h2><p>{accountError}</p><button className="button secondary" onClick={() => void loadAccount()}>Retry</button></section> : account?.organizations.find((organization) => organization.id === selectedOrganizationID) ? <ChangesetsPage key={selectedOrganizationID} organization={account.organizations.find((organization) => organization.id === selectedOrganizationID)!} onNotify={notify} /> : <section className="card org-auth-state"><h2>No active organization</h2><p>This account has no active organization membership.</p></section>
          ) : active === "Overview" ? (
            <OverviewPage onNavigate={setActive} onNotify={notify} created={[]} />
          ) : ["Changesets", "Eval", "Review", "Trails", "Stacks", "Self-healing"].includes(active) ? (
            <DeliveryFlow page={active} onNotify={notify} />
          ) : (
            <ResourceWorkspacePage key={active} page={active} onNotify={notify} />
          )}
          <footer>
            <span>AgentForge Prototype <b>v0.1.0</b></span>
            <span><i className="live-dot" /> All systems operational <span className="footer-sep">·</span> Mock environment</span>
          </footer>
        </div>
      </main>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={setActive} />
    </div>
  );
}

export default App;
