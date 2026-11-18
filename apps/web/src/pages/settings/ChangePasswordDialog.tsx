import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "../../shared/ui/components/form-controls";
import { Modal } from "../../shared/ui/components";
import { identityManagementAPI, APIError } from "../../shared/api/identities";

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

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};

    if (!currentPassword) {
      newErrors.current = t("changePassword.error.currentIncorrect");
    }

    if (newPassword.length < 8) {
      newErrors.new = t("changePassword.error.tooShort");
    }

    if (newPassword !== confirmPassword) {
      newErrors.confirm = t("changePassword.error.notMatch");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    setErrors({});

    if (!validateForm()) {
      throw new Error(t("changePassword.error.validation"));
    }

    try {
      await identityManagementAPI.changePassword(currentPassword, newPassword);

      // Reset form
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      onSuccess();
    } catch (error: unknown) {
      if (error instanceof APIError) {
        if (error.status === 401 || error.status === 403) {
          setErrors({ current: t("changePassword.error.currentIncorrect") });
          throw new Error(t("changePassword.error.currentIncorrect"));
        } else {
          throw new Error(error.message || t("changePassword.error.generic"));
        }
      } else {
        throw new Error(t("changePassword.error.generic"));
      }
    }
  };

  const handleClose = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrors({});
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("changePassword.title")}
      onCancel={handleClose}
      onOk={handleSubmit}
      okText={t("changePassword.submit")}
      cancelText={t("changePassword.cancel")}
      okVariant="primary"
    >
      <PasswordInput
        label={t("changePassword.currentPassword")}
        name="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        error={errors.current}
        required
        autoComplete="current-password"
        controlSize="middle"
      />

      <PasswordInput
        label={t("changePassword.newPassword")}
        name="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        error={errors.new}
        required
        autoComplete="new-password"
        controlSize="middle"
      />

      <PasswordInput
        label={t("changePassword.confirmPassword")}
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
