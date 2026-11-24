import { useEffect, useId, useState } from "react";
import { Menu } from "lucide-react";
import { Navigate, Outlet, useLocation, useMatches, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { APIError, accountAPI, authAPI, repositoryAPI, type AccountContext } from "../shared/api/identity";
import { translateError } from "../shared/api/errors";
import { CURRENT_ORGANIZATION_HANDLE, findOrganizationByHandle, organizationHandle } from "../shared/routing";
import { Button } from "../shared/ui";
import { AppAccountContext, useSelectedOrganization, type AccountState } from "./account-context";
import { Sidebar } from "./components/Sidebar";
import { AccountTheme } from "../features/appearance/AccountTheme";
import { Topbar } from "./components/Topbar";
import { repositoryIssuesSettingChanged } from "../pages/repositories/repositoryPermissions";
import { RepositoryNavigation } from "../pages/repositories/RepositoryNavigation";
import { RepositorySwitcher } from "./components/RepositorySwitcher";
import { CommandPalette } from "./components/CommandPalette";
import { navigationItemFor, repositorySectionForPath, routeLabel } from "./navigation";
import { useNotify } from "./useNotify";
import { useSearchShortcut } from "./useSearchShortcut";

/** Root layout: loads the account once and renders the shell around the page the URL selects. */
function App() {
  const { t } = useTranslation("app");
  const [commandOpen, setCommandOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const notify = useNotify();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const { org: urlHandle } = useParams();
  const matches = useMatches();
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [accountState, setAccountState] = useState<AccountState>("loading");
  const [accountError, setAccountError] = useState("");
  const [rememberedOrganization, setSelectedOrganizationID] = useSelectedOrganization(account);

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
      else { setAccountState("unavailable"); setAccountError(translateError(cause, t, "app:errors.accountLoadFailed")); }
    }
  };

  useEffect(() => { void loadAccount(); }, []);

  // Inside /orgs/:org the URL decides which organization is selected; elsewhere the last selection does.
  const urlOrganization = urlHandle && account ? findOrganizationByHandle(account.organizations, urlHandle) : undefined;
  const selectedOrganization = urlOrganization ?? rememberedOrganization;
  // Visiting an organization's URL also selects it, so the choice survives leaving /orgs/:org.
  const urlOrganizationID = urlOrganization?.id;
  useEffect(() => { if (urlOrganizationID) setSelectedOrganizationID(urlOrganizationID); }, [urlOrganizationID]);
  // Links keep the handle form the visitor used (id or slug), so the open page's sidebar item stays current.
  const linkHandle = (urlOrganization && urlHandle) || (selectedOrganization ? organizationHandle(selectedOrganization) : CURRENT_ORGANIZATION_HANDLE);

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
  const repositorySection = repositorySectionForPath(match?.pathname);
  const isRepositoryDetail = Boolean(owner && repo) && (label === "Repository" || label === "Issue" || label === "New Issue" || repositorySection === "pulls") && accountState === "ready" && Boolean(urlOrganization);
  const repository = isRepositoryDetail ? `${owner}/${repo}` : undefined;
  const [disabledIssuesKey, setDisabledIssuesKey] = useState<string>();
  const repositoryKey = urlOrganizationID && repository ? `${urlOrganizationID}:${repository}` : undefined;
  const issuesDisabled = Boolean(repositoryKey && disabledIssuesKey === repositoryKey);
  useEffect(() => {
    if (!urlOrganizationID || !repository || !repositoryKey) return;
    let request: AbortController;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void repositoryAPI.settings(urlOrganizationID, repository, controller.signal).then(settings => {
        if (!controller.signal.aborted) setDisabledIssuesKey(settings.issues_disabled ? repositoryKey : undefined);
      }).catch(() => { /* Repository pages surface errors from their own requests. */ });
    };
    refresh();
    window.addEventListener(repositoryIssuesSettingChanged, refresh);
    return () => { request.abort(); window.removeEventListener(repositoryIssuesSettingChanged, refresh); };
  }, [urlOrganizationID, repository, repositoryKey]);
  const isOverview = label === "Overview";
  const pageLabelId = useId();
  return (
    <AppAccountContext.Provider value={{ account, accountState, accountError, reload: loadAccount, selectedOrganization, selectOrganization: setSelectedOrganizationID }}>
      {account && <AccountTheme key={account.user_id} />}
      <div className="shell">
        <Topbar label={label} pageLabelId={pageLabelId} onSearch={() => setCommandOpen(true)} onSignOut={() => void signOut()}
          context={isRepositoryDetail && urlOrganization && owner && repo ? <RepositorySwitcher key={`${urlOrganization.id}:${owner}/${repo}`}
            organizationId={urlOrganization.id} organizationName={urlOrganization.name} handle={linkHandle} owner={owner} repo={repo} section={repositorySection} /> : undefined}
          navigation={<Button variant="ghost" className="workspace-icon" aria-label={t("navigation:sidebar.openNavigation")}
            aria-haspopup="dialog" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={17} aria-hidden="true" /></Button>}
          organizationHandle={selectedOrganization ? linkHandle : undefined} />
        {isRepositoryDetail && urlOrganization && <RepositoryNavigation organization={urlOrganization} handle={linkHandle} repository={`${owner}/${repo}`} issuesDisabled={issuesDisabled} />}
        <Sidebar open={navigationOpen} linkHandle={linkHandle} onClose={() => setNavigationOpen(false)} />
        <main className="main" aria-labelledby={isRepositoryDetail ? undefined : pageLabelId}>
          <div className={isRepositoryCatalog ? "content content--collection" : "content"}>
            {trailingSlash ? <Navigate replace to={{ pathname: pathname.replace(/\/+$/, "") || "/", search, hash }} /> : issuesDisabled && repositorySection === "issues"
              ? <section className="card org-auth-state"><h2>{t("repositories:settings.issuesDisabled")}</h2></section>
              : <Outlet />}
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
