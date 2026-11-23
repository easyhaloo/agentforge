import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import type { TFunction } from "i18next";
import { Key, Plus } from "lucide-react";
import { ConfirmDialog, Button, Input } from "../../shared/ui/components";
import { TextArea } from "../../shared/ui/components/form-controls";
import { settingsAPI, type SSHKey } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import { useDateFormatting } from "../../shared/i18n/format";
import { useSettingsList } from "./useSettingsList";
import type { SettingsOutletContext } from "./SettingsLayout";

import "./access-settings.css";

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
  const { formatDate, formatRelativeTime } = useDateFormatting();

  const { items: keys, loading, refresh } = useSettingsList(settingsAPI.getSSHKeys);
  const [showAddForm, setShowAddForm] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<SSHKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add key form state
  const [title, setTitle] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [errors, setErrors] = useState<{ title?: string; publicKey?: string }>({});

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
      refresh();
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
      refresh();
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

  return (
    <div className="settings-page access-settings">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("keys.title")}</h1>
        <p className="settings-page-description">{t("keys.description")}</p>
      </header>

      <div className="settings-stack">
        <section>
          <div className="settings-section-heading access-toolbar">
            <h2>{t("keys.sshKeys")}</h2>
            {!loading && keys && !showAddForm && (
              <Button size="small" onClick={() => setShowAddForm(true)}>
                <Plus size={16} aria-hidden="true" /> {t("keys.addSSHKey")}
              </Button>
            )}
          </div>
          {loading ? (
            <p className="settings-note" role="status">{t("common:status.loading")}</p>
          ) : !keys ? (
            <div className="access-meta">
              <p role="alert">{t("keys.loadError")}</p>
              <Button onClick={refresh}>{t("common:actions.retry")}</Button>
            </div>
          ) : (
            <>
              {showAddForm && (
                <form className="settings-box access-form" onSubmit={handleAddKey}>
                  <Input
                    label={t("keys.keyTitle")}
                    name="title"
                    autoFocus
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
                  <div className="access-meta">
                    <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
                      {submitting ? t("common:status.saving", { ns: "common" }) : t("keys.addSSHKey")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={submitting}
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
                </form>
              )}
              <ul className="settings-box access-list">
                {keys.length === 0 && <li className="settings-box-row settings-note">{t("keys.noKeys")}</li>}
                {keys.map((key) => (
                  <li key={key.key_id} className="settings-box-row access-row">
                    <Key className="access-icon" size={20} aria-hidden="true" />
                    <div className="access-details">
                      <div className="access-title">
                        <strong>{key.title}</strong>
                        <span className="access-badge">{key.key_type} · {t("keys.keyBits", { count: key.key_bits })}</span>
                      </div>
                      <div className="settings-note">{t("keys.fingerprint")}: <code>{key.fingerprint}</code></div>
                      <div className="settings-note access-meta">
                        <span>{t("keys.created")}: <time dateTime={key.created_at}>{formatDate(key.created_at)}</time></span>
                        <span>{t("keys.lastUsed")}: {formatLastUsed(key.last_used_at)}</span>
                      </div>
                    </div>
                    <Button size="small" disabled={submitting} onClick={() => setKeyToDelete(key)} aria-label={`${t("keys.deleteKey")} · ${key.title}`}>
                      {t("keys.deleteKey")}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section>
          <h2 className="settings-section-heading">{t("keys.gpgTitle")}</h2>
          <p className="settings-note">{t("keys.gpgComingSoon")}</p>
        </section>
      </div>

      {/* Delete Key Confirmation Dialog */}
      <ConfirmDialog
        open={keyToDelete !== null}
        title={t("keys.deleteKeyTitle")}
        description={`${t("keys.deleteKeyConfirm")} ${keyToDelete?.title ?? ""}`}
        confirmText={t("keys.deleteKey")}
        danger
        onConfirm={() => { if (keyToDelete) return handleDeleteKey(keyToDelete); }}
        onCancel={() => setKeyToDelete(null)}
      />
    </div>
  );
}
