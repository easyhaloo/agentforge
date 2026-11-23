import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../shared/api/errors";
import { repositoryGitAPI, type GitCredential, type OrganizationSummary } from "../../shared/api/identity";
import { Button, Input, Modal, Select } from "../../shared/ui";

type Scope = "read" | "write";

export function RepositoryCloneDialog({ open, onClose, organization, repository }: {
  open: boolean; onClose: () => void; organization: OrganizationSummary; repository: string;
}) {
  const { t } = useTranslation("repositories");
  const [scope, setScope] = useState<Scope>("read");
  const [credential, setCredential] = useState<GitCredential>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const active = credential && Date.parse(credential.expires_at) > Date.now() ? credential : undefined;
  const cloneURL = `${window.location.origin}/git/${[organization.id, ...repository.split("/")].map(encodeURIComponent).join("/")}.git`;

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      await action();
    } catch (cause) {
      setError(translateError(cause, t, "repositories:clone.failed"));
    } finally {
      setBusy(false);
    }
  }

  function copy(value: string) {
    return act(async () => {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    });
  }

  return <Modal open={open} title={t("clone.title")} cancelText={t("common:actions.close")} onCancel={() => {
    if (busy) return;
    setCredential(value => value && { ...value, token: "" });
    setCopied(false);
    setError("");
    onClose();
  }}>
    <div className="repo-clone-dialog">
      <Input label={t("clone.url")} value={cloneURL} readOnly />
      <div className="repo-clone-actions"><Button disabled={busy} onClick={() => copy(cloneURL)}>{t("clone.copyUrl")}</Button></div>
      <p>{t("clone.hint")}</p>
      {active ? <>
        <p>{t(active.token ? "clone.issued" : "clone.active")}</p>
        <div className="repo-clone-actions">
          {active.token && <Button disabled={busy} onClick={() => copy(active.token)}>{t("clone.copyToken")}</Button>}
          <Button disabled={busy} onClick={() => act(async () => {
            await repositoryGitAPI.revokeCredential(organization.id, repository, active.id);
            setCredential(undefined);
          })}>{t("clone.revoke")}</Button>
        </div>
      </> : <>
        <Select label={t("clone.scope")} value={scope} disabled={busy}
          options={[{ value: "read", label: t("clone.read") }, ...(organization.role === "viewer" ? [] : [{ value: "write", label: t("clone.write") }])]}
          onChange={event => setScope(event.target.value === "write" ? "write" : "read")} />
        <div className="repo-clone-actions"><Button disabled={busy} onClick={() => act(async () => {
          setCredential(await repositoryGitAPI.createCredential(organization.id, repository, scope));
        })}>{t("clone.create")}</Button></div>
      </>}
      {copied && <p role="status">{t("clone.copied")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}
