import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Key, Plus, X } from "lucide-react";
import { Button, Input } from "../../shared/ui/components";
import { TextArea } from "../../shared/ui/components/form-controls";
import { settingsAPI, type SSHKey } from "../../shared/api/settings";
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
            {cancelText || "Cancel"}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

function validateSSHKey(key: string): string | null {
  const trimmed = key.trim();

  if (!trimmed) {
    return "SSH key is required";
  }

  // Check if it starts with a supported type
  const validPrefixes = ["ssh-rsa", "ssh-ed25519", "ecdsa-sha2-"];
  if (!validPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return "Unsupported key type. Must be RSA, Ed25519, or ECDSA.";
  }

  // Check format (at least 2 parts: type and key data)
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return "Invalid SSH key format. Expected: <type> <key-data> [comment]";
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
      notify(err instanceof Error ? err.message : "Failed to load SSH keys");
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

    const keyValidation = validateSSHKey(publicKey);
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
      notify(t("keys.addSuccess"));
      setTitle("");
      setPublicKey("");
      setShowAddForm(false);
      await loadKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add SSH key";
      setErrors({ publicKey: message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteKey = async (key: SSHKey) => {
    setSubmitting(true);
    try {
      await settingsAPI.deleteSSHKey(key.key_id);
      notify(t("keys.deleteSuccess"));
      await loadKeys();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to delete SSH key");
    } finally {
      setSubmitting(false);
      setKeyToDelete(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatLastUsed = (dateString: string | null) => {
    if (!dateString) return t("keys.never");

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t("keys.today");
    if (diffDays === 1) return t("keys.yesterday");
    if (diffDays < 7) return t("keys.daysAgo", { count: diffDays });
    if (diffDays < 30) return t("keys.weeksAgo", { count: Math.floor(diffDays / 7) });

    return formatDate(dateString);
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
              {t("keys.sshTitle")}
            </h2>
            {!showAddForm && (
              <Button
                variant="primary"
                size="small"
                onClick={() => setShowAddForm(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Plus size={16} />
                {t("keys.addKey")}
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
                    placeholder="e.g., Work Laptop"
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
                    placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAbc..."
                    rows={4}
                    required
                  />
                  <div style={{ display: "flex", gap: "12px" }}>
                    <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
                      {submitting ? t("common:status.saving", { ns: "common" }) : t("keys.addKey")}
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
                          {key.key_type} · {key.key_bits} bits
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
                          {t("keys.added")}: {formatDate(key.created_at)} · {t("keys.lastUsed")}:{" "}
                          {formatLastUsed(key.last_used_at)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => setKeyToDelete(key)}
                      disabled={submitting}
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
        description={t("keys.deleteConfirm")}
        confirmText={t("keys.deleteKey")}
        danger
        onConfirm={() => keyToDelete && handleDeleteKey(keyToDelete)}
        onCancel={() => setKeyToDelete(null)}
      />
    </div>
  );
}
