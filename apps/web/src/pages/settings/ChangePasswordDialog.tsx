import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "../../shared/ui/components/form-controls";
import { Modal } from "../../shared/ui/components";
import { identityManagementAPI, APIError } from "../../shared/api/identities";
import { translateError } from "../../shared/api/errors";

export interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChangePasswordDialog({ open, onClose, onSuccess }: ChangePasswordDialogProps) {
  const { t } = useTranslation("settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{
    current?: string;
    new?: string;
    confirm?: string;
  }>({});
  // The message the dialog shows when the whole submission failed. It is a translated sentence
  // rather than the API's own English prose, and it never leaves the dialog as an Error.
  const [submitError, setSubmitError] = useState("");

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};

    if (!currentPassword) {
      newErrors.current = t("authentication.error.currentIncorrect");
    }

    if (newPassword.length < 8) {
      newErrors.new = t("authentication.passwordRequirements");
    }

    if (newPassword !== confirmPassword) {
      newErrors.confirm = t("authentication.passwordMismatch");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    setErrors({});
    setSubmitError("");

    if (!validateForm()) {
      setSubmitError(t("authentication.error.validation"));
      return;
    }

    try {
      await identityManagementAPI.changePassword(currentPassword, newPassword);

      // Reset form
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      onSuccess();
    } catch (cause: unknown) {
      if (cause instanceof APIError && (cause.status === 401 || cause.status === 403)) {
        setErrors({ current: t("authentication.error.currentIncorrect") });
        setSubmitError(t("authentication.error.currentIncorrect"));
        return;
      }
      setSubmitError(translateError(cause, t, "settings:authentication.error.generic"));
    }
  };

  const handleClose = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrors({});
    setSubmitError("");
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("authentication.changePassword")}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText={t("authentication.changePassword")}
      cancelText={t("common:actions.cancel")}
      okVariant="primary"
    >
      {submitError && (
        <p role="alert" style={{ margin: "0 0 16px 0", color: "var(--color-error)" }}>
          {submitError}
        </p>
      )}

      <PasswordInput
        label={t("authentication.currentPassword")}
        name="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        error={errors.current}
        required
        autoComplete="current-password"
        controlSize="middle"
      />

      <PasswordInput
        label={t("authentication.newPassword")}
        name="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        error={errors.new}
        required
        autoComplete="new-password"
        controlSize="middle"
      />

      <PasswordInput
        label={t("authentication.confirmPassword")}
        name="confirm-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        error={errors.confirm}
        required
        autoComplete="new-password"
        controlSize="middle"
      />
    </Modal>
  );
}
