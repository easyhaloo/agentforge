import { useEffect, useState } from "react";
import { Building2, CircleAlert, Lock, Globe, UserRound } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { repositoryAPI, type AccountContext, type OrganizationSummary, type RepositoryVisibility } from "../../shared/api/identity";
import { APIError, translateError } from "../../shared/api/errors";
import { organizationHandle, orgPath, repositoryPath } from "../../shared/routing";
import { Button, Checkbox, Input, Select, Switch } from "../../shared/ui";
import { RepositoryCreatePicker } from "./RepositoryCreatePicker";
import { canManageRepository } from "./RepositoryMasthead";
import "./repositories.css";

const validName = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;

type Props = {
  organization: OrganizationSummary;
  account: AccountContext;
  onNotify: (message: string) => void;
};

export function RepositoryCreatePage({ organization, account, onNotify }: Props) {
  const { t } = useTranslation("repositories");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const registering = params.get("mode") === "register";
  const owners = account.organizations.filter(canManageRepository);
  const [ownerID, setOwnerID] = useState(organization.id);
  const owner = owners.find(item => item.id === ownerID) ?? owners[0];
  const [namespace, setNamespace] = useState(organizationHandle(organization));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState("main");
  const [visibility, setVisibility] = useState<RepositoryVisibility>();
  const [fork, setFork] = useState(false);
  const [readme, setReadme] = useState(false);
  const [gitignore, setGitignore] = useState("");
  const [license, setLicense] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snapshot, setSnapshot] = useState<{ ownerID: string; slugs: Set<string> }>();
  const target = registering ? organization : owner;
  const targetID = target?.id;
  const prefix = registering ? namespace.trim() : owner ? organizationHandle(owner) : "";
  const nameTrim = name.trim();
  const slug = `${prefix}/${nameTrim}`;
  const key = `${targetID}/${slug}`;
  const nameValid = registering ? Boolean(nameTrim) && !/[\s/]/.test(nameTrim) : validName.test(nameTrim) && !nameTrim.endsWith(".");
  const duplicate = conflict === key || (snapshot && snapshot.ownerID === targetID && snapshot.slugs.has(slug));
  const nameError = duplicate ? t("create.nameTaken", { name: nameTrim }) :
    (nameTrim || attempted) && !nameValid ? t(registering ? "create.ownerError" : "create.invalidName") : "";
  const namespaceValid = Boolean(prefix) && !/[\s/]/.test(prefix);
  const canSubmit = registering ? canManageRepository(organization) : Boolean(owner);
  const repositoriesPath = orgPath(organizationHandle(organization), "repositories");

  useEffect(() => {
    if (!targetID) return;
    let active = true;
    repositoryAPI.list(targetID).then(({ items }) => {
      if (active) setSnapshot({ ownerID: targetID, slugs: new Set((items ?? []).map(item => item.slug)) });
    }).catch(() => { /* The server still checks conflicts on submission. */ });
    return () => { active = false; };
  }, [targetID]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!target || !canSubmit || !namespaceValid || !nameValid || duplicate || !branch.trim() || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = registering
        ? await repositoryAPI.register(target.id, slug, branch.trim(), { visibility, fork })
        : await repositoryAPI.create(target.id, slug, description, { readme, gitignore, license });
      onNotify(registering ? t("feedback.registered") : t("create.created"));
      navigate(repositoryPath(organizationHandle(target), result.slug));
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 409) {
        setConflict(key);
      } else if (cause instanceof APIError && cause.status === 422 && registering) {
        setError(t("feedback.repositoryNotFound"));
      } else if (cause instanceof APIError && cause.status === 503 && !registering) {
        setError(t("create.providerUnavailable"));
      } else {
        setError(translateError(cause, t, registering ? "repositories:feedback.registrationFailed" : "repositories:create.outbound"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="repo-create-container">
    <div className="repo-create-content">
      <h1>{t(registering ? "create.registerButton" : "create.title")}</h1>
      <p className="repo-create-intro">{t(registering ? "create.intro" : "create.createIntro")}</p>
      {!canSubmit ? <p className="org-error" role="alert">{t("create.accessDenied")}</p> :
        <form onSubmit={handleSubmit} noValidate>
          <fieldset className="repo-create-fieldset" disabled={submitting}>
            <section className="repo-create-section" aria-labelledby="repo-create-general">
              <h2 id="repo-create-general"><span className="repo-create-step" aria-hidden="true">1</span>{t("create.generalSection")}</h2>
              <div className="repo-create-slug-fields">
                {registering ? <Input label={t("create.ownerLabel")} aria-label={t("create.ownerLabel")} value={namespace} autoComplete="off" required
                  onChange={event => setNamespace(event.target.value)} error={attempted && !namespaceValid ? t("create.ownerError") : ""} /> :
                  <div className="af-field repo-create-owner"><span className="af-field__label" aria-hidden="true">{t("create.ownerLabel")}</span>
                  <RepositoryCreatePicker label={t("create.ownerLabel")} value={owner?.id ?? ""} onChange={setOwnerID}
                    heading={t("create.chooseOwner")} searchLabel={t("create.searchOwners")} emptyLabel={t("create.noOwners")}
                    options={owners.map(item => ({ value: item.id, label: item.personal ? account.display_name : item.name,
                      description: t(item.personal ? "create.personalAccount" : "create.organizationAccount"),
                      icon: item.personal ? <UserRound size={16}/> : <Building2 size={16}/> }))} /></div>}
                <span className="repo-create-slash" aria-hidden="true">/</span>
                <Input label={t("create.repositoryNameLabel")} aria-label={t("create.repositoryNameLabel")} value={name} onChange={event => setName(event.target.value)}
                  error={nameError ? <><CircleAlert size={13} aria-hidden="true"/> {nameError}</> : undefined}
                  required autoComplete="off" spellCheck={false} />
              </div>
              {!registering && <div className="repo-create-description">
                <Input label={t("create.descriptionLabel")} value={description} onChange={event => setDescription(Array.from(event.target.value).slice(0, 350).join(""))} />
                <span className="repo-create-hint">{t("create.descriptionCount", { count: Array.from(description).length })}</span>
              </div>}
            </section>

            <section className="repo-create-section" aria-labelledby="repo-create-configuration">
              <h2 id="repo-create-configuration"><span className="repo-create-step" aria-hidden="true">2</span>{t("create.configurationSection")}</h2>
              {registering ? <div className="repo-create-configuration">
                <Input label={t("create.defaultBranchLabel")} aria-label={t("create.defaultBranchLabel")} value={branch} onChange={event => setBranch(event.target.value)}
                  hint={t("create.defaultBranchHelp")} error={attempted && !branch.trim() ? t("create.defaultBranchError") : ""} required autoComplete="off" />
                <Select label={t("form.visibility")} value={visibility ?? ""}
                  onChange={event => {
                    const value = event.target.value;
                    setVisibility(value === "public" || value === "private" ? value : undefined);
                  }}
                  options={[
                    { label: t("form.visibilityUnknown"), value: "" },
                    { label: t("types.public"), value: "public" },
                    { label: t("types.private"), value: "private" },
                  ]} />
                <Checkbox label={t("types.fork")} checked={fork} onChange={event => setFork(event.target.checked)} />
              </div> :
                <div className="repo-create-configuration">
                  <div className="repo-create-option repo-create-visibility">
                    <div><strong>{t("create.visibilityLabel")}</strong><p>{t("create.visibilityHelp")}</p></div>
                    <RepositoryCreatePicker align="end" label={t("create.visibilityLabel")} value="private" onChange={() => {}} heading={t("create.chooseVisibility")}
                      options={[
                        { value: "private", label: t("create.private"), icon: <Lock size={16}/>, description: t("create.privateHelp") },
                        { value: "public", label: t("create.public"), icon: <Globe size={16}/>, description: t("create.publicUnavailable"), disabled: true },
                      ]} />
                  </div>
                  <div className="repo-create-options">
                    <Switch className="repo-create-option" label={t("create.readmeLabel")} description={t("create.readmeHelp")}
                      checked={readme} onChange={event => setReadme(event.target.checked)} />
                    <div className="repo-create-option">
                      <div><strong>{t("create.gitignoreLabel")}</strong><p>{t("create.gitignoreHelp")}</p></div>
                      <RepositoryCreatePicker align="end" label={t("create.gitignoreLabel")} value={gitignore} onChange={setGitignore}
                        searchLabel={t("create.searchTemplates")} emptyLabel={t("create.noTemplates")} options={[
                          { value: "", label: t("create.noGitignore") }, { value: "node", label: "Node" }, { value: "python", label: "Python" }, { value: "go", label: "Go" },
                        ]} />
                    </div>
                    <div className="repo-create-option">
                      <div><strong>{t("create.licenseLabel")}</strong><p>{t("create.licenseHelp")}</p></div>
                      <RepositoryCreatePicker align="end" label={t("create.licenseLabel")} value={license} onChange={setLicense}
                        options={[{ value: "", label: t("create.noLicense") }, { value: "mit", label: "MIT" }]} />
                    </div>
                  </div>
                </div>}
            </section>
          </fieldset>
          {error && <p className="org-error" role="alert">{error}</p>}
          <div className="repo-create-actions">
            <Link className="repo-create-mode-link" to={registering ? "." : "?mode=register"}>{t(registering ? "create.title" : "create.registerExisting")}</Link>
            <Link to={repositoriesPath}>{t("create.cancel")}</Link>
            <Button variant="primary" type="submit" disabled={submitting || Boolean(duplicate)}>{t(registering ? "create.registerButton" : "create.createButton")}</Button>
          </div>
        </form>}
    </div>
  </div>;
}
