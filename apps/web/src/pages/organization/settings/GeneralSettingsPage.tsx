import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, ConfirmDialog, Input, Select } from "../../../shared/ui";
import { organizationLifecycleAPI } from "../../../shared/api/organizationLifecycle";
import { organizationAPI, type OrganizationMember } from "../../../shared/api/identity";
import { translateError } from "../../../shared/api/errors";
import { useDateFormatting } from "../../../shared/i18n/format";
import type { OrganizationLifecycleState } from "./useOrganizationLifecycle";
import "./organization-lifecycle.css";

/** The SPEC's slug pattern, shared by the inline validation and the confirm gating. */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,37}[a-z0-9])$/;

/** One red-bordered danger-zone row: title + description on the left, action on the right. */
function DangerRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="org-danger-row">
      <div className="org-danger-row__copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

/** Inactive action (SPEC 4.1): focusable, tooltip explains why, click opens a reason dialog. */
function InactiveAction({ label, reason, what }: { label: string; reason: string; what: string }) {
  const { t } = useTranslation("common");
  const [explaining, setExplaining] = useState(false);
  return (
    <>
      <Button inactive inactiveReason={reason} onInactiveClick={() => setExplaining(true)}>{label}</Button>
      <ConfirmDialog
        open={explaining}
        title={what}
        description={reason}
        confirmText={t("common:actions.close")}
        onCancel={() => setExplaining(false)}
        onConfirm={() => setExplaining(false)}
      />
    </>
  );
}

/** Confirms by typing the organization slug (SPEC 4.1 "输入后确认"). */
function SlugConfirm({ slug, value, onChange }: { slug: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation("settings");
  return (
    <Input
      label={t("settings:lifecycle.danger.typeToConfirm", { slug })}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

type Dialog = null | "rename" | "transfer" | "suspend" | "delete" | "resume" | "cancelDeletion";

export function OrganizationGeneralSettingsPage({ lifecycle }: { lifecycle: OrganizationLifecycleState }) {
  const { t } = useTranslation("settings");
  const { formatDateTime } = useDateFormatting();
  const { organization } = lifecycle;
  const locked = lifecycle.status !== "active";
  const isOwner = organization.role === "owner";

  const [name, setName] = useState(organization.name);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [newSlug, setNewSlug] = useState(organization.slug);
  const [suspendReason, setSuspendReason] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [busy, setBusy] = useState(false);

  const slugChanged = newSlug !== "" && newSlug !== organization.slug;
  const slugValid = ORGANIZATION_SLUG_PATTERN.test(newSlug);
  const confirmReady = confirmSlug === organization.slug;

  const notOwnerReason = t("settings:lifecycle.general.inactiveNotOwner");
  const lockedReason = t("settings:lifecycle.general.inactiveOrgLocked");
  const updateInactiveReason = locked ? lockedReason : isOwner ? "" : notOwnerReason;
  const deleteInactiveReason = !isOwner
    ? notOwnerReason
    : lifecycle.status !== "suspended" ? t("settings:lifecycle.danger.delete.inactiveNotSuspended") : "";
  const resumeInactiveReason = !isOwner
    ? notOwnerReason
    : lifecycle.status === "pending_deletion" ? t("settings:lifecycle.danger.resume.inactivePendingDeletion") : "";

  const openDialog = (next: Dialog) => {
    setDialog(next);
    setConfirmSlug("");
    setSuspendReason("");
    setNewSlug(organization.slug);
    setTransferTarget("");
    if (next === "transfer") {
      void organizationAPI.members(organization.id).then(
        (page) => setMembers(page.items.filter((member) => member.status === "active" && member.user_id && member.user_id !== "")),
        () => setMembers([]),
      );
    }
  };

  const run = async (action: () => Promise<unknown>, successKey: string, failureKey: string, close: () => void) => {
    setBusy(true);
    try {
      const state = await action() as Parameters<typeof lifecycle.apply>[0];
      if (state && typeof state === "object" && "status" in state) lifecycle.apply(state);
      setFeedback({ status: "success", message: t(successKey) });
      close();
    } catch (cause) {
      setFeedback({ status: "error", message: translateError(cause, t, failureKey) });
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = () =>
    run(
      () => organizationLifecycleAPI.update(organization.id, { name: name.trim() }),
      "settings:lifecycle.general.saveSuccess",
      "settings:lifecycle.errors.renameFailed",
      () => {},
    );

  const banner = lifecycle.status === "pending_deletion" && lifecycle.deletionScheduledAt
    ? { status: "error" as const, title: t("settings:lifecycle.banner.pendingDeletionTitle", { date: formatDateTime(lifecycle.deletionScheduledAt) }), body: t("settings:lifecycle.banner.pendingDeletionBody") }
    : lifecycle.status === "suspended" && lifecycle.suspendedAt
      ? {
          status: "warning" as const,
          title: t("settings:lifecycle.banner.suspendedTitle", { date: formatDateTime(lifecycle.suspendedAt) }),
          body: lifecycle.suspendedReason
            ? t("settings:lifecycle.banner.suspendedBody", { reason: lifecycle.suspendedReason })
            : t("settings:lifecycle.banner.suspendedBodyPlain"),
        }
      : lifecycle.identityReady === false
        ? { status: "warning" as const, title: t("settings:lifecycle.banner.identityNotReadyTitle"), body: t("settings:lifecycle.banner.identityNotReadyBody") }
        : null;

  return <div className="org-lifecycle-page">
    {banner && <Alert status={banner.status} title={banner.title} className="org-lifecycle-banner">{banner.body}</Alert>}
    {feedback && <Alert status={feedback.status} closable onClose={() => setFeedback(null)} className="org-lifecycle-banner">{feedback.message}</Alert>}

    <h2 className="org-lifecycle-subhead">{t("settings:lifecycle.general.title")}</h2>
    <div className="org-lifecycle-form">
      <Input label={t("settings:lifecycle.general.nameLabel")} value={name} disabled={locked} onChange={(event) => setName(event.target.value)} />
      {updateInactiveReason
        ? <InactiveAction label={t("settings:lifecycle.general.updateButton")} reason={updateInactiveReason} what={t("settings:lifecycle.general.updateButton")} />
        : <Button variant="primary" loading={saving} onClick={() => void saveProfile()}>{t("settings:lifecycle.general.updateButton")}</Button>}
    </div>

    <h2 className="org-lifecycle-subhead org-lifecycle-subhead--danger">{t("settings:lifecycle.danger.title")}</h2>
    <div className="org-danger-box">
      <DangerRow title={t("settings:lifecycle.danger.url.title")} description={t("settings:lifecycle.danger.url.description", { slug: organization.slug })}>
        {updateInactiveReason
          ? <InactiveAction label={t("settings:lifecycle.danger.url.action")} reason={updateInactiveReason} what={t("settings:lifecycle.danger.url.action")} />
          : <Button variant="danger" onClick={() => openDialog("rename")}>{t("settings:lifecycle.danger.url.action")}</Button>}
      </DangerRow>
      <DangerRow title={t("settings:lifecycle.danger.transfer.title")} description={t("settings:lifecycle.danger.transfer.description")}>
        {updateInactiveReason
          ? <InactiveAction label={t("settings:lifecycle.danger.transfer.action")} reason={updateInactiveReason} what={t("settings:lifecycle.danger.transfer.action")} />
          : <Button variant="danger" onClick={() => openDialog("transfer")}>{t("settings:lifecycle.danger.transfer.action")}</Button>}
      </DangerRow>
      {lifecycle.status === "active" ? (
        <DangerRow title={t("settings:lifecycle.danger.suspend.title")} description={t("settings:lifecycle.danger.suspend.description")}>
          {!isOwner
            ? <InactiveAction label={t("settings:lifecycle.danger.suspend.action")} reason={notOwnerReason} what={t("settings:lifecycle.danger.suspend.action")} />
            : <Button variant="danger" onClick={() => openDialog("suspend")}>{t("settings:lifecycle.danger.suspend.action")}</Button>}
        </DangerRow>
      ) : (
        <DangerRow
          title={t("settings:lifecycle.danger.resume.title")}
          description={lifecycle.status === "pending_deletion"
            ? t("settings:lifecycle.danger.resume.descriptionPending")
            : t("settings:lifecycle.danger.resume.descriptionSuspended")}
        >
          {resumeInactiveReason
            ? <InactiveAction label={t("settings:lifecycle.danger.resume.action")} reason={resumeInactiveReason} what={t("settings:lifecycle.danger.resume.action")} />
            : <Button onClick={() => openDialog("resume")}>{t("settings:lifecycle.danger.resume.action")}</Button>}
        </DangerRow>
      )}
      {lifecycle.status === "pending_deletion" ? (
        <DangerRow
          title={t("settings:lifecycle.danger.cancelDeletion.title")}
          description={t("settings:lifecycle.danger.cancelDeletion.description", { date: lifecycle.deletionScheduledAt ? formatDateTime(lifecycle.deletionScheduledAt) : "" })}
        >
          {!isOwner
            ? <InactiveAction label={t("settings:lifecycle.danger.cancelDeletion.action")} reason={notOwnerReason} what={t("settings:lifecycle.danger.cancelDeletion.action")} />
            : <Button onClick={() => openDialog("cancelDeletion")}>{t("settings:lifecycle.danger.cancelDeletion.action")}</Button>}
        </DangerRow>
      ) : (
        <DangerRow title={t("settings:lifecycle.danger.delete.title")} description={t("settings:lifecycle.danger.delete.description")}>
          {deleteInactiveReason
            ? <InactiveAction label={t("settings:lifecycle.danger.delete.action")} reason={deleteInactiveReason} what={t("settings:lifecycle.danger.delete.action")} />
            : <Button variant="danger" onClick={() => openDialog("delete")}>{t("settings:lifecycle.danger.delete.action")}</Button>}
        </DangerRow>
      )}
    </div>

    <ConfirmDialog
      open={dialog === "rename"}
      title={t("settings:lifecycle.danger.url.dialogTitle")}
      description={organization.name}
      danger
      focusCancel
      lockDismiss
      banner={<Alert status="warning" dismissible={false}>{t("settings:lifecycle.danger.url.dialogBanner", { oldSlug: organization.slug })}</Alert>}
      onCancel={() => setDialog(null)}
      onConfirm={() => void run(
        () => organizationLifecycleAPI.update(organization.id, { slug: newSlug }),
        "settings:lifecycle.danger.url.success",
        "settings:lifecycle.errors.renameFailed",
        () => setDialog(null),
      )}
    >
      <Input
        label={t("settings:lifecycle.danger.url.newLabel")}
        value={newSlug}
        onChange={(event) => setNewSlug(event.target.value.trim().toLowerCase())}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={slugChanged && !slugValid}
        error={slugChanged && !slugValid ? t("settings:lifecycle.general.urlInvalid") : undefined}
      />
      {slugChanged && slugValid && <p className="org-inline-ok" aria-live="polite">✓ {newSlug}</p>}
    </ConfirmDialog>

    <ConfirmDialog
      open={dialog === "transfer"}
      title={t("settings:lifecycle.danger.transfer.dialogTitle")}
      description={organization.slug}
      danger
      focusCancel
      lockDismiss
      onCancel={() => setDialog(null)}
      onConfirm={() => void run(
        () => organizationLifecycleAPI.transferOwnership(organization.id, transferTarget),
        "settings:lifecycle.danger.transfer.success",
        "settings:lifecycle.errors.transferFailed",
        () => setDialog(null),
      )}
    >
      <p>{t("settings:lifecycle.danger.transfer.dialogDescription")}</p>
      <Select
        label={t("settings:lifecycle.danger.transfer.searchLabel")}
        value={transferTarget}
        onChange={(event) => setTransferTarget(event.target.value)}
        options={members.map((member) => ({ value: member.user_id, label: `${member.display_name} (${member.role})` }))}
        placeholder={t("settings:lifecycle.danger.transfer.searchPlaceholder")}
      />
      <SlugConfirm slug={organization.slug} value={confirmSlug} onChange={setConfirmSlug} />
    </ConfirmDialog>

    <ConfirmDialog
      open={dialog === "suspend"}
      title={t("settings:lifecycle.danger.suspend.dialogTitle")}
      description={organization.slug}
      danger
      focusCancel
      lockDismiss
      banner={<Alert status="warning" dismissible={false}>{t("settings:lifecycle.danger.suspend.dialogBanner")}</Alert>}
      onCancel={() => setDialog(null)}
      onConfirm={() => void run(
        () => organizationLifecycleAPI.suspend(organization.id, suspendReason.trim()),
        "settings:lifecycle.danger.suspend.success",
        "settings:lifecycle.errors.suspendFailed",
        () => setDialog(null),
      )}
    >
      <Input
        label={t("settings:lifecycle.danger.suspend.reasonLabel")}
        value={suspendReason}
        onChange={(event) => setSuspendReason(event.target.value)}
        placeholder={t("settings:lifecycle.danger.suspend.reasonPlaceholder")}
      />
      <SlugConfirm slug={organization.slug} value={confirmSlug} onChange={setConfirmSlug} />
    </ConfirmDialog>

    <ConfirmDialog
      open={dialog === "resume"}
      title={`${t("settings:lifecycle.danger.resume.action")}?`}
      description={organization.slug}
      focusCancel
      onCancel={() => setDialog(null)}
      onConfirm={() => void run(
        () => organizationLifecycleAPI.resume(organization.id),
        "settings:lifecycle.danger.resume.success",
        "settings:lifecycle.errors.resumeFailed",
        () => setDialog(null),
      )}
    />

    <ConfirmDialog
      open={dialog === "cancelDeletion"}
      title={`${t("settings:lifecycle.danger.cancelDeletion.action")}?`}
      description={t("settings:lifecycle.danger.cancelDeletion.description", { date: lifecycle.deletionScheduledAt ? formatDateTime(lifecycle.deletionScheduledAt) : "" })}
      focusCancel
      onCancel={() => setDialog(null)}
      onConfirm={() => void run(
        () => organizationLifecycleAPI.cancelDeletion(organization.id),
        "settings:lifecycle.danger.cancelDeletion.success",
        "settings:lifecycle.errors.cancelDeletionFailed",
        () => setDialog(null),
      )}
    />

    <DeleteOrganizationDialog
      open={dialog === "delete"}
      lifecycle={lifecycle}
      busy={busy}
      onClose={() => setDialog(null)}
      onConfirm={() => void run(
        () => organizationLifecycleAPI.scheduleDeletion(organization.id),
        "settings:lifecycle.danger.delete.success",
        "settings:lifecycle.errors.deleteFailed",
        () => setDialog(null),
      )}
      confirmSlug={confirmSlug}
      setConfirmSlug={setConfirmSlug}
      confirmReady={confirmReady}
    />
  </div>;
}

/** The prototype's three-step delete confirmation; step 3 requires the slug. */
function DeleteOrganizationDialog({ open, lifecycle, busy, onClose, onConfirm, confirmSlug, setConfirmSlug, confirmReady }: {
  open: boolean;
  lifecycle: OrganizationLifecycleState;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmSlug: string;
  setConfirmSlug: (value: string) => void;
  confirmReady: boolean;
}) {
  const { t } = useTranslation("settings");
  const [step, setStep] = useState(1);
  if (!open) return null;
  return (
    <ConfirmDialog
      open
      title={t("settings:lifecycle.danger.delete.dialogTitle")}
      description={lifecycle.organization.name}
      danger
      focusCancel={step === 3}
      lockDismiss
      banner={step === 2 ? <Alert status="error" dismissible={false}>{t("settings:lifecycle.danger.delete.step2Banner", { date: lifecycle.deletionScheduledAt ? lifecycle.deletionScheduledAt.slice(0, 10) : "" })}</Alert> : undefined}
      onCancel={onClose}
      onConfirm={step === 3 ? onConfirm : () => setStep(step + 1)}
    >
      <p className="org-delete-steps">{t(`settings:lifecycle.danger.delete.step${step}Of3`)}</p>
      {step === 1 && <p>{t("settings:lifecycle.danger.delete.step1Body", { name: lifecycle.organization.name })}</p>}
      {step === 2 && (
        <ul className="org-delete-effects">
          {t("settings:lifecycle.danger.delete.step2Items").split("|").map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {step === 3 && <SlugConfirm slug={lifecycle.organization.slug} value={confirmSlug} onChange={setConfirmSlug} />}
    </ConfirmDialog>
  );
}
