import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Navigate, Outlet, useLocation, useMatches, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { APIError, accountAPI, authAPI, type AccountContext } from "../shared/api/identity";
import { translateError } from "../shared/api/errors";
import { CURRENT_ORGANIZATION_HANDLE, findOrganizationByHandle, organizationHandle, repositorySections, withOrganizationHandle } from "../shared/routing";
import { Button, Select } from "../shared/ui";
import { AppAccountContext, type AccountState } from "./account-context";
import { Sidebar } from "./components/Sidebar";
import { AccountTheme } from "../features/appearance/AccountTheme";
import { Topbar } from "./components/Topbar";
import { RepositoryNavigation } from "../pages/repositories/RepositoryNavigation";
import { RepositorySwitcher } from "./components/RepositorySwitcher";
import { PageHeader } from "./components/PageHeader";
import { CommandPalette } from "./components/CommandPalette";
import { navigationItemFor, routeLabel } from "./navigation";
import { useNavigateTo } from "./useNavigateTo";
import { useNotify } from "./useNotify";
import { useSearchShortcut } from "./useSearchShortcut";

/** Root layout: loads the account once and renders the shell around the page the URL selects. */
function App() {
  const { t } = useTranslation("app");
  const [commandOpen, setCommandOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const notify = useNotify();
  const navigateTo = useNavigateTo();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
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
      else { setAccountState("unavailable"); setAccountError(translateError(cause, t, "app:errors.accountLoadFailed")); }
    }
  };

  useEffect(() => { void loadAccount(); }, []);

  // Inside /orgs/:org the URL decides which organization is selected; elsewhere the last selection does.
  const urlOrganization = urlHandle && account ? findOrganizationByHandle(account.organizations, urlHandle) : undefined;
  const selectedOrganization = urlOrganization ?? account?.organizations.find((item) => item.id === selectedOrganizationID);
  // Visiting an organization's URL also selects it, so the choice survives leaving /orgs/:org.
  const urlOrganizationID = urlOrganization?.id;
  useEffect(() => { if (urlOrganizationID) setSelectedOrganizationID(urlOrganizationID); }, [urlOrganizationID]);
  // Links keep the handle form the visitor used (id or slug), so the open page's sidebar item stays current.
  const linkHandle = (urlOrganization && urlHandle) || (selectedOrganization ? organizationHandle(selectedOrganization) : CURRENT_ORGANIZATION_HANDLE);

  const selectOrganization = (organizationID: string) => {
    setSelectedOrganizationID(organizationID);
    const next = account?.organizations.find((item) => item.id === organizationID);
    if (next && urlHandle) {
      // Organization details reference objects owned by the previous organization.
      const section = pathname.split("/").slice(0, 4).join("/");
      navigateTo(withOrganizationHandle(section, organizationHandle(next)));
    }
  };

  const signOut = async () => {
    try {
      await authAPI.logout();
      navigate("/login", { replace: true });
      notify(t("app:notify.signedOut"));
    } catch (cause) {
      setAccountError(translateError(cause, t, "app:errors.signOutFailed"));
      setAccountState("unavailable");
    }
  };

  useSearchShortcut(!commandOpen, () => {
    setNavigationOpen(false);
    setCommandOpen(true);
  }, !navigationOpen);

  // The router serves /projects/ like /projects, but the sidebar highlights only the exact path (NavLink `end`), so
  // trailing slashes are removed (history `replace`, query and hash kept) before a page is shown.
  const trailingSlash = pathname.length > 1 && pathname.endsWith("/");

  const match = matches.at(-1);
  const label = routeLabel(match?.handle);
  const item = navigationItemFor(label);
  const isRepositoryCatalog = label === "Repositories" && accountState === "ready" && Boolean(urlOrganization);
  const { owner, repo } = match?.params ?? {};
  const repositorySection = repositorySections.find(section => section === match?.pathname.split("/")[6]);
  const isRepositoryDetail = Boolean(owner && repo) && (label === "Repository" || label === "Issue" || repositorySection === "pulls") && accountState === "ready" && Boolean(urlOrganization);
  const isOverview = label === "Overview";
  // Organization pages are backed by the account API; the mock pages only simulate a refresh.
  const refresh = () => {
    if (urlHandle) void loadAccount();
    else notify("Demo data refreshed.");
  };
  const organizationSelect = <Select aria-label={t("navigation:sidebar.selectOrganization")} value={selectedOrganization?.id ?? ""}
    placeholder={t("navigation:sidebar.noOrganization")} disabled={!account?.organizations.length}
    onChange={event => { selectOrganization(event.target.value); setNavigationOpen(false); }}
    options={(account?.organizations ?? []).map(org => ({ label: org.name, value: org.id }))} />;

  return (
    <AppAccountContext.Provider value={{ account, accountState, accountError, reload: loadAccount, selectedOrganization }}>
      {account && <AccountTheme key={account.user_id} />}
      <div className="shell">
        <Topbar label={label} onSearch={() => setCommandOpen(true)} onSignOut={() => void signOut()}
          context={isRepositoryDetail && urlOrganization && owner && repo ? <RepositorySwitcher key={`${urlOrganization.id}:${owner}/${repo}`}
            organizationId={urlOrganization.id} handle={linkHandle} owner={owner} repo={repo} section={repositorySection} /> : undefined}
          navigation={<Button variant="ghost" className="workspace-icon" aria-label={t("navigation:sidebar.openNavigation")}
            aria-haspopup="dialog" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={17} aria-hidden="true" /></Button>}
          organizationHandle={selectedOrganization ? linkHandle : undefined}
          organization={<div className="workspace-organization">{organizationSelect}</div>} />
        {isRepositoryDetail && urlOrganization && <RepositoryNavigation organization={urlOrganization} handle={linkHandle} repository={`${owner}/${repo}`} />}
        <Sidebar open={navigationOpen} linkHandle={linkHandle} onClose={() => setNavigationOpen(false)} organizationPicker={organizationSelect} />
        <main className="main">
          <div className={isRepositoryCatalog ? "content content--collection" : "content"}>
            {!isOverview && !isRepositoryCatalog && !isRepositoryDetail && (label !== "CI / CD" || accountState !== "ready" || !urlOrganization) &&
              <PageHeader label={label} descriptionKey={item?.descriptionKey} onRefresh={item ? refresh : undefined} />}
            {trailingSlash ? <Navigate replace to={{ pathname: pathname.replace(/\/+$/, "") || "/", search, hash }} /> : <Outlet />}
            {!isOverview && !urlHandle && item && <footer>{t("app:footer.mockEnvironment")}</footer>}
          </div>
        </main>
        <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} linkHandle={linkHandle}
          repository={isRepositoryDetail && owner && repo ? `${owner}/${repo}` : undefined} />
      </div>
    </AppAccountContext.Provider>
  );
}

export default App;
