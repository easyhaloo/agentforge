import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { Button, Input } from "../../shared/ui/components";
import { TextArea } from "../../shared/ui/components/form-controls";
import { settingsAPI, type UserProfile } from "../../shared/api/settings";
import { translateError } from "../../shared/api/errors";
import type { SettingsOutletContext } from "./SettingsLayout";

interface ProfileFormData {
  display_name: string;
  bio: string;
  location: string;
  website?: string;
}

interface FormErrors {
  display_name?: string;
  bio?: string;
  location?: string;
  website?: string;
}

function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function ProfileSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState<ProfileFormData>({
    display_name: "",
    bio: "",
    location: "",
    website: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Load profile on mount
  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        setLoading(true);
        const data = await settingsAPI.getProfile();
        if (mounted) {
          setProfile(data);
          setFormData({
            display_name: data.display_name,
            bio: data.bio,
            location: data.location,
            website: "", // Website not in current API response
          });
        }
      } catch (err) {
        if (mounted) {
          notify(translateError(err, t, "settings:errors.loadProfileFailed"));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [notify]);

  const validateForm = (): FormErrors => {
    const newErrors: FormErrors = {};

    if (!formData.display_name?.trim()) {
      newErrors.display_name = t("profile.displayNameRequired");
    } else if (formData.display_name.length > 100) {
      newErrors.display_name = t("profile.displayNameTooLong");
    }

    if (formData.bio && formData.bio.length > 500) {
      newErrors.bio = t("profile.bioTooLong");
    }

    if (formData.location && formData.location.length > 100) {
      newErrors.location = t("profile.locationTooLong");
    }

    if (formData.website && formData.website.trim() && !isValidURL(formData.website)) {
      newErrors.website = t("profile.websiteInvalid");
    }

    return newErrors;
  };

  const handleChange = (field: keyof ProfileFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    setErrors({});

    try {
      const updated = await settingsAPI.updateProfile({
        display_name: formData.display_name,
        bio: formData.bio,
        location: formData.location,
      });
      setProfile(updated);
      setIsDirty(false);
      notify(t("profile.saveSuccess"));
    } catch (err) {
      setErrors({ display_name: translateError(err, t, "settings:errors.saveProfileFailed") });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("profile.title")}</h1>
          <p className="settings-page-description">{t("profile.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("profile.title")}</h1>
          <p className="settings-page-description">{t("profile.description")}</p>
        </header>
        <div className="settings-placeholder" style={{ color: "var(--color-error)" }}>
          {t("errors.loadProfileFailed")}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("profile.title")}</h1>
        <p className="settings-page-description">{t("profile.description")}</p>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Display Name */}
          <Input
            label={t("profile.displayName")}
            name="display_name"
            value={formData.display_name}
            onChange={(e) => handleChange("display_name", e.target.value)}
            error={errors.display_name}
            hint={t("profile.displayNameHint")}
            required
            maxLength={100}
          />

          {/* Bio */}
          <div>
            <TextArea
              label={t("profile.bio")}
              name="bio"
              value={formData.bio}
              onChange={(e) => handleChange("bio", e.target.value)}
              error={errors.bio}
              placeholder={t("profile.bioPlaceholder")}
              rows={4}
              maxLength={500}
            />
            <div style={{ textAlign: "right", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
              {formData.bio.length} / 500
            </div>
          </div>

          {/* Location */}
          <Input
            label={t("profile.location")}
            name="location"
            value={formData.location}
            onChange={(e) => handleChange("location", e.target.value)}
            error={errors.location}
            placeholder={t("profile.locationPlaceholder")}
            maxLength={100}
          />

          {/* Website */}
          <Input
            label={t("profile.website")}
            name="website"
            value={formData.website}
            onChange={(e) => handleChange("website", e.target.value)}
            error={errors.website}
            placeholder={t("profile.websitePlaceholder")}
            hint={t("profile.websiteComingSoon")}
            disabled
            maxLength={100}
          />

          {/* Avatar Upload Note */}
          <div style={{
            padding: "12px",
            backgroundColor: "var(--color-bg-hover)",
            borderRadius: "6px",
            fontSize: "14px",
            color: "var(--color-text-secondary)"
          }}>
            <strong>{t("profile.avatar")}</strong>: {t("profile.avatarComingSoon")}
          </div>

          {/* Save Button */}
          <div style={{ paddingTop: "8px" }}>
            <Button
              type="submit"
              variant="primary"
              disabled={!isDirty || saving}
              loading={saving}
            >
              {saving ? t("common:status.saving", { ns: "common" }) : t("common:actions.save", { ns: "common" })}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
