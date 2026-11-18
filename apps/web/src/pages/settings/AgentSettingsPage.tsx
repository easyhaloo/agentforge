import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "../../shared/ui/components";
import { Checkbox, RadioGroup, Switch } from "../../shared/ui/components/form-controls";
import { settingsAPI, type AgentPreferences } from "../../shared/api/settings";
import type { SettingsOutletContext } from "./SettingsLayout";

// Simple confirm dialog component
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

export function AgentSettingsPage() {
  const { t } = useTranslation("settings");
  const { notify } = useOutletContext<SettingsOutletContext>();

  const [preferences, setPreferences] = useState<AgentPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showClearMemoryDialog, setShowClearMemoryDialog] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);

  // Load agent preferences on mount
  useEffect(() => {
    let mounted = true;

    async function loadPreferences() {
      try {
        setLoading(true);
        const data = await settingsAPI.getAgentPreferences();
        if (mounted) {
          setPreferences(data);
        }
      } catch (err) {
        if (mounted) {
          notify(err instanceof Error ? err.message : "Failed to load agent preferences");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadPreferences();

    return () => {
      mounted = false;
    };
  }, [notify]);

  const handleFieldChange = <K extends keyof AgentPreferences>(field: K, value: AgentPreferences[K]) => {
    if (!preferences) return;

    setPreferences({ ...preferences, [field]: value });
    setIsDirty(true);
  };

  const handleReviewFocusChange = (focus: keyof AgentPreferences["review_focus"], checked: boolean) => {
    if (!preferences) return;

    setPreferences({
      ...preferences,
      review_focus: { ...preferences.review_focus, [focus]: checked },
    });
    setIsDirty(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preferences || saving) return;

    setSaving(true);

    try {
      const updated = await settingsAPI.updateAgentPreferences(preferences);
      setPreferences(updated);
      setIsDirty(false);
      notify(t("agents.saveSuccess"));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save agent preferences");
    } finally {
      setSaving(false);
    }
  };

  const handleClearMemory = async () => {
    setClearingMemory(true);

    try {
      await settingsAPI.clearAgentMemory();
      notify(t("agents.memoryCleared"));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to clear agent memory");
    } finally {
      setClearingMemory(false);
      setShowClearMemoryDialog(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("agents.title")}</h1>
          <p className="settings-page-description">{t("agents.description")}</p>
        </header>
        <div className="settings-placeholder">
          {t("common:status.loading", { ns: "common" })}
        </div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="settings-page">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{t("agents.title")}</h1>
          <p className="settings-page-description">{t("agents.description")}</p>
        </header>
        <div className="settings-placeholder" style={{ color: "var(--color-error)" }}>
          Failed to load agent preferences
        </div>
      </div>
    );
  }

  const verbosityOptions = [
    { label: t("agents.verbosityConcise"), value: "concise" },
    { label: t("agents.verbosityStandard"), value: "standard" },
    { label: t("agents.verbosityVerbose"), value: "verbose" },
  ];

  const confirmationOptions = [
    { label: t("agents.confirmAlways"), value: "always" },
    { label: t("agents.confirmBatch"), value: "batch" },
    { label: t("agents.confirmAuto"), value: "auto" },
  ];

  const automationOptions = [
    { label: t("agents.automationConservative"), value: "conservative" },
    { label: t("agents.automationBalanced"), value: "balanced" },
    { label: t("agents.automationAggressive"), value: "aggressive" },
  ];

  const strictnessOptions = [
    { label: t("agents.strictnessStrict"), value: "strict" },
    { label: t("agents.strictnessStandard"), value: "standard" },
    { label: t("agents.strictnessLenient"), value: "lenient" },
  ];

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="settings-page-title">{t("agents.title")}</h1>
        <p className="settings-page-description">{t("agents.description")}</p>
      </header>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {/* 1. Agent Output Verbosity */}
          <section>
            <RadioGroup
              label={t("agents.verbosityTitle")}
              name="output_verbosity"
              value={preferences.output_verbosity}
              options={verbosityOptions}
              onChange={(value: string) => handleFieldChange("output_verbosity", value as AgentPreferences["output_verbosity"])}
            />
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
              {preferences.output_verbosity === "concise" && t("agents.verbosityConciseDesc")}
              {preferences.output_verbosity === "standard" && t("agents.verbosityStandardDesc")}
              {preferences.output_verbosity === "verbose" && t("agents.verbosityVerboseDesc")}
            </p>
          </section>

          {/* 2. Agent Confirmation Strategy */}
          <section>
            <RadioGroup
              label={t("agents.confirmTitle")}
              name="confirmation_strategy"
              value={preferences.confirmation_strategy}
              options={confirmationOptions}
              onChange={(value: string) => handleFieldChange("confirmation_strategy", value as AgentPreferences["confirmation_strategy"])}
            />
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
              {preferences.confirmation_strategy === "always" && t("agents.confirmAlwaysDesc")}
              {preferences.confirmation_strategy === "batch" && t("agents.confirmBatchDesc")}
              {preferences.confirmation_strategy === "auto" && t("agents.confirmAutoDesc")}
            </p>
          </section>

          {/* 3. Agent Automation Level */}
          <section>
            <RadioGroup
              label={t("agents.automationTitle")}
              name="automation_level"
              value={preferences.automation_level}
              options={automationOptions}
              onChange={(value: string) => handleFieldChange("automation_level", value as AgentPreferences["automation_level"])}
            />
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "8px" }}>
              {preferences.automation_level === "conservative" && t("agents.automationConservativeDesc")}
              {preferences.automation_level === "balanced" && t("agents.automationBalancedDesc")}
              {preferences.automation_level === "aggressive" && t("agents.automationAggressiveDesc")}
            </p>
          </section>

          {/* 4. Agent Cross-Session Memory */}
          <section>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
              {t("agents.memoryTitle")}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <Switch
                id="cross-session-memory"
                name="cross_session_memory_enabled"
                checked={preferences.cross_session_memory_enabled}
                onChange={(e) => handleFieldChange("cross_session_memory_enabled", e.target.checked)}
                label={t("agents.memoryEnabled")}
              />
              <div>
                <Button
                  type="button"
                  variant="danger"
                  size="small"
                  onClick={() => setShowClearMemoryDialog(true)}
                  disabled={clearingMemory}
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                >
                  <AlertTriangle size={16} />
                  {t("agents.clearMemory")}
                </Button>
                <p style={{ fontSize: "13px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
                  {t("agents.clearMemoryWarning")}
                </p>
              </div>
            </div>
          </section>

          {/* 5. Changeset Evaluation Preferences */}
          <section>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
              {t("agents.evaluationTitle")}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <Checkbox
                id="auto-evaluate"
                name="auto_evaluate_on_push"
                checked={preferences.auto_evaluate_on_push}
                onChange={(e) => handleFieldChange("auto_evaluate_on_push", e.target.checked)}
                label={t("agents.autoEvaluate")}
              />
              <Checkbox
                id="notify-results"
                name="notify_evaluation_results"
                checked={preferences.notify_evaluation_results}
                onChange={(e) => handleFieldChange("notify_evaluation_results", e.target.checked)}
                label={t("agents.notifyResults")}
              />
              <RadioGroup
                label={t("agents.strictness")}
                name="evaluation_strictness"
                value={preferences.evaluation_strictness}
                options={strictnessOptions}
                onChange={(value: string) => handleFieldChange("evaluation_strictness", value as AgentPreferences["evaluation_strictness"])}
              />
            </div>
          </section>

          {/* 6. Code Review Preferences */}
          <section>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--color-text-primary)" }}>
              {t("agents.reviewTitle")}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <Checkbox
                id="agent-review"
                name="agent_review_enabled"
                checked={preferences.agent_review_enabled}
                onChange={(e) => handleFieldChange("agent_review_enabled", e.target.checked)}
                label={t("agents.agentReview")}
              />
              <Checkbox
                id="agent-approve"
                name="agent_can_approve_low_risk"
                checked={preferences.agent_can_approve_low_risk}
                onChange={(e) => handleFieldChange("agent_can_approve_low_risk", e.target.checked)}
                label={t("agents.agentApprove")}
              />

              <fieldset style={{ border: "none", padding: 0, margin: "8px 0 0 0" }}>
                <legend style={{ fontSize: "14px", fontWeight: 500, marginBottom: "12px", color: "var(--color-text-primary)" }}>
                  {t("agents.reviewFocusTitle")}
                </legend>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <Checkbox
                    id="focus-security"
                    name="focus_security"
                    checked={preferences.review_focus.security}
                    onChange={(e) => handleReviewFocusChange("security", e.target.checked)}
                    label={t("agents.focusSecurity")}
                  />
                  <Checkbox
                    id="focus-performance"
                    name="focus_performance"
                    checked={preferences.review_focus.performance}
                    onChange={(e) => handleReviewFocusChange("performance", e.target.checked)}
                    label={t("agents.focusPerformance")}
                  />
                  <Checkbox
                    id="focus-style"
                    name="focus_code_style"
                    checked={preferences.review_focus.code_style}
                    onChange={(e) => handleReviewFocusChange("code_style", e.target.checked)}
                    label={t("agents.focusStyle")}
                  />
                  <Checkbox
                    id="focus-tests"
                    name="focus_test_coverage"
                    checked={preferences.review_focus.test_coverage}
                    onChange={(e) => handleReviewFocusChange("test_coverage", e.target.checked)}
                    label={t("agents.focusTests")}
                  />
                  <Checkbox
                    id="focus-docs"
                    name="focus_documentation"
                    checked={preferences.review_focus.documentation}
                    onChange={(e) => handleReviewFocusChange("documentation", e.target.checked)}
                    label={t("agents.focusDocs")}
                  />
                </div>
              </fieldset>
            </div>
          </section>

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

      {/* Clear Memory Confirmation Dialog */}
      <ConfirmDialog
        open={showClearMemoryDialog}
        title={t("agents.clearMemoryTitle")}
        description={t("agents.clearMemoryConfirm")}
        confirmText={t("agents.clearMemory")}
        danger
        onConfirm={handleClearMemory}
        onCancel={() => setShowClearMemoryDialog(false)}
      />
    </div>
  );
}
