import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import type { TFunction } from "i18next";
import { Key, Plus, X } from "lucide-react";
import { Button, Input } from "../../shared/ui/components";
import { TextArea } from "../../shared/ui/components/form-controls";
import { settingsAPI, type SSHKey } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { formatDate, formatRelativeTime } from "../../shared/i18n/format";
import type { SettingsOutletContext } from "./SettingsLayout";

// Simple confirm dialog component (reused from Sessions)
function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("settings");

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "500px",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: "0 0 24px 0", color: "var(--color-text-secondary)" }}>{description}</p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel}>
            {cancelText || t("common:actions.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

function validateSSHKey(key: string, t: TFunction): string | null {
  const trimmed = key.trim();

  if (!trimmed) {
    return t("keys.keyRequired");
  }

  // Check if it starts with a supported type
  const validPrefixes = ["ssh-rsa", "ssh-ed25519", "ecdsa-sha2-"];
  if (!validPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return t("keys.unsupportedKeyType");
  }

  // Check format (at least 2 parts: type and key data)
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return t("keys.invalidKeyFormat");
  }

  return null;
}

export function KeysSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<SSHKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add key form state
  const [title, setTitle] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [errors, setErrors] = useState<{ title?: string; publicKey?: string }>({});

  const loadKeys = async () => {
    try {
      setLoading(true);
      const data = await settingsAPI.getSSHKeys();
      setKeys(data);
    } catch (err) {
      notify(translateError(err, t, "settings:errors.loadKeysFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: { title?: string; publicKey?: string } = {};

    if (!title.trim()) {
      newErrors.title = t("keys.titleRequired");
    }

    const keyValidation = validateSSHKey(publicKey, t);
    if (keyValidation) {
      newErrors.publicKey = keyValidation;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      await settingsAPI.addSSHKey({
        title: title.trim(),
        public_key: publicKey.trim(),
      });
      notify(t("keys.keyAdded"));
      setTitle("");
      setPublicKey("");
      setShowAddForm(false);
      await loadKeys();
    } catch (err) {
      setErrors({ publicKey: translateError(err, t, "settings:errors.addKeyFailed") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteKey = async (key: SSHKey) => {
    setSubmitting(true);
    try {
      await settingsAPI.deleteSSHKey(key.key_id);
      notify(t("keys.keyDeleted"));
      await loadKeys();
    } catch (err) {
      notify(translateError(err, t, "settings:errors.deleteKeyFailed"));
    } finally {
      setSubmitting(false);
      setKeyToDelete(null);
    }
  };

  const formatLastUsed = (dateString: string | null) => {
    if (!dateString) return t("keys.neverUsed");
    return formatRelativeTime(dateString);
  };

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("keys.title")}</h1>
          <p className="settings-page-description">{t("keys.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("keys.title")}</h1>
        <p className="settings-page-description">{t("keys.description")}</p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* SSH Keys Section */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0, color: "var(--color-text-primary)" }}>
              {t("keys.sshKeys")}
            </h2>
            {!showAddForm && (
              <Button
                variant="primary"
                size="small"
                onClick={() => setShowAddForm(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Plus size={16} />
                {t("keys.addSSHKey")}
              </Button>
            )}
          </div>

          {/* Add Key Form */}
          {showAddForm && (
            <div
              className="settings-card"
              style={{ marginBottom: "16px", padding: "20px", backgroundColor: "var(--color-bg-hover)" }}
            >
              <form onSubmit={handleAddKey}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <Input
                    label={t("keys.keyTitle")}
                    name="title"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                    }}
                    error={errors.title}
                    placeholder={t("keys.keyTitlePlaceholder")}
                    required
                  />
                  <TextArea
                    label={t("keys.publicKey")}
                    name="public_key"
                    value={publicKey}
                    onChange={(e) => {
                      setPublicKey(e.target.value);
                      if (errors.publicKey) setErrors((prev) => ({ ...prev, publicKey: undefined }));
                    }}
                    error={errors.publicKey}
                    placeholder={t("keys.publicKeyPlaceholder")}
                    rows={4}
                    required
                  />
                  <div style={{ display: "flex", gap: "12px" }}>
                    <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
                      {submitting ? t("common:status.saving", { ns: "common" }) : t("keys.addSSHKey")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setShowAddForm(false);
                        setTitle("");
                        setPublicKey("");
                        setErrors({});
                      }}
                    >
                      {t("common:actions.cancel", { ns: "common" })}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* SSH Keys List */}
          {keys.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: "var(--color-text-tertiary)" }}>
              {t("keys.noKeys")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {keys.map((key) => (
                <div key={key.key_id} className="settings-card">
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ color: "var(--color-text-secondary)", marginTop: "2px" }}>
                      <Key size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, marginBottom: "8px" }}>{key.title}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" }}>
                        <div style={{ color: "var(--color-text-secondary)" }}>
                          {key.key_type} · {t("keys.keyBits", { count: key.key_bits })}
                        </div>
                        <div style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>
                          {t("keys.fingerprint")}
                        </div>
                        <div
                          style={{
                            color: "var(--color-text-tertiary)",
                            fontFamily: "monospace",
                            fontSize: "12px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {key.fingerprint}
                        </div>
                        <div style={{ color: "var(--color-text-tertiary)", fontSize: "13px" }}>
                          {t("keys.created")}: {formatDate(key.created_at)} · {t("keys.lastUsed")}:{" "}
                          {formatLastUsed(key.last_used_at)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => setKeyToDelete(key)}
                      disabled={submitting}
                      title={t("keys.deleteKey")}
                      aria-label={t("keys.deleteKey")}
                      style={{ color: "var(--color-error)" }}
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* GPG Keys Placeholder */}
        <section>
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px", color: "var(--color-text-primary)" }}>
            {t("keys.gpgTitle")}
          </h2>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "14px" }}>{t("keys.gpgComingSoon")}</p>
        </section>
      </div>

      {/* Delete Key Confirmation Dialog */}
      <ConfirmDialog
        open={keyToDelete !== null}
        title={t("keys.deleteKeyTitle")}
        description={t("keys.deleteKeyConfirm")}
        confirmText={t("keys.deleteKey")}
        danger
        onConfirm={() => keyToDelete && handleDeleteKey(keyToDelete)}
        onCancel={() => setKeyToDelete(null)}
      />
    </div>
  );
}
