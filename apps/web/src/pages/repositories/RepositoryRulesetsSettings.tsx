import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { repositoryAPI, type RefNamePattern, type OrganizationSummary, type RepositorySettings, type RepositoryRefRule } from "../../shared/api/identity";
import { translateError } from "../../shared/api/errors";
import { Button, Checkbox, Input, Select, TextArea } from "../../shared/ui";
import { canManageRepository } from "./repositoryPermissions";
import { maxRulesetFileBytes, namePatternOperators, parseRulesetJson, serializeRulesetJson } from "./rulesetJson";

const maxRules = 10;
const maxNameLength = 80;
const maxPatterns = 10;
const maxNamePatterns = 10;
const maxNamePatternBytes = 1024;
const restrictionLabels = {
  restrict_creation: "settings.rulesets.restrictCreation",
  restrict_update: "settings.rulesets.restrictUpdate",
  restrict_deletion: "settings.rulesets.restrictDeletion",
  block_force_push: "settings.rulesets.blockForcePush",
  require_linear_history: "settings.rulesets.requireLinearHistory",
  require_pull_request: "settings.rulesets.requirePullRequest",
  require_merge_queue: "settings.rulesets.requireMergeQueue",
} as const;
const restrictions = Object.keys(restrictionLabels) as Array<keyof typeof restrictionLabels>;

type RuleDraft = Omit<RepositoryRefRule, "include" | "exclude"> & { id: number; include: string; exclude: string };
type Props = {
  organization: OrganizationSummary;
  repository: string;
};

function toDraft(rule: RepositoryRefRule, id: number): RuleDraft {
  return { ...rule, id, include: rule.include.join("\n"), exclude: (rule.exclude ?? []).join("\n") };
}

function patterns(value: string) {
  return value.split(/\r?\n/).map(pattern => pattern.trim()).filter(Boolean);
}

function toRule({ id: _id, name, include, exclude, require_pull_request, require_merge_queue, require_linear_history, name_patterns, ...rule }: RuleDraft): RepositoryRefRule {
  return { ...rule, name: name.trim(), include: patterns(include), exclude: patterns(exclude),
    ...(require_pull_request && { require_pull_request }),
    ...(require_merge_queue && { require_merge_queue }),
    ...(require_linear_history && { require_linear_history }),
    ...(name_patterns?.length && { name_patterns: name_patterns.map(({ operator, pattern, name, negate }) => ({
      operator, pattern, ...(name && { name }), ...(negate && { negate }),
    })) }),
  };
}

export function RepositoryRulesetsSettings({ organization, repository }: Props) {
  const { t } = useTranslation("repositories");
  const [settings, setSettings] = useState<RepositorySettings>();
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [editing, setEditing] = useState<number>();
  const [invalidRule, setInvalidRule] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const busy = saving || importing;
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const nextId = useRef(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const focusAdd = useRef(false);
  const validationAlert = useRef<HTMLParagraphElement>(null);
  const errorId = useId();

  useEffect(() => {
    let active = true;
    void repositoryAPI.settings(organization.id, repository).then(result => {
      if (!active) return;
      setSettings(result);
      setRules((result.ref_rules ?? []).map(rule => toDraft(rule, nextId.current++)));
    }).catch(cause => {
      if (active) setLoadError(translateError(cause, t, "repositories:sections.settingsFailed"));
    });
    return () => { active = false; };
  }, [organization.id, repository, retry, t]);

  useEffect(() => {
    if (focusAdd.current) {
      focusAdd.current = false;
      addButton.current?.focus();
    }
  }, [rules]);

  useEffect(() => {
    validationAlert.current?.focus();
  }, [invalidRule]);

  const canManage = canManageRepository(organization);
  const canEdit = canManage && settings?.hosting_kind === "hosted";
  const payload = rules.map(toRule);
  const baseline = (settings?.ref_rules ?? []).map((rule, index) => toRule(toDraft(rule, index)));
  const changed = JSON.stringify(payload) !== JSON.stringify(baseline);

  function changeRules(next: RuleDraft[]) {
    setRules(next);
    setSaved(false);
    setError("");
    setInvalidRule(undefined);
  }

  function addRule() {
    if (!canEdit || busy || rules.length >= maxRules) return;
    const id = nextId.current++;
    changeRules([...rules, {
      id, name: "", target: "branch", enabled: true, include: "", exclude: "",
      restrict_creation: false, restrict_update: false, restrict_deletion: false, block_force_push: false,
    }]);
    setEditing(id);
  }

  function validationError(rule: RepositoryRefRule, index: number) {
    if (!rule.name) return t("settings.rulesets.nameRequired");
    if ([...rule.name].length > maxNameLength) return t("settings.rulesets.nameTooLong", { max: maxNameLength });
    if (payload.some((other, i) => i !== index && rule.name.toLowerCase() === other.name.toLowerCase())) {
      return t("settings.rulesets.duplicateName");
    }
    if (!rule.include.length) return t("settings.rulesets.includeRequired");
    if (rule.include.length + rule.exclude.length > maxPatterns) return t("settings.rulesets.tooManyPatterns", { max: maxPatterns });
    if (rule.target === "tag" && (rule.block_force_push || rule.require_pull_request || rule.require_merge_queue || rule.require_linear_history)) return t("settings.rulesets.tagBranchRestrictions");
    if (rule.require_merge_queue && (rule.include.length !== 1 || rule.include[0] !== "~DEFAULT_BRANCH" || rule.exclude.length)) {
      return t("settings.rulesets.mergeQueueTarget");
    }
    if (rule.name_patterns?.some(({ pattern, name }) => !pattern || new TextEncoder().encode(pattern).length > maxNamePatternBytes ||
      (name && [...name].length > maxNameLength)) || (rule.name_patterns?.length ?? 0) > maxNamePatterns) return t("settings.rulesets.namePatternInvalid");
    if (!rule.name_patterns?.length && !restrictions.some(restriction => rule[restriction])) return t("settings.rulesets.restrictionRequired");
    return "";
  }

  async function importRuleset(file: File) {
    if (!canEdit || busy || rules.length >= maxRules) return;
    setImporting(true);
    setError("");
    setInvalidRule(undefined);
    setSaved(false);
    try {
      const rule = file.size <= maxRulesetFileBytes ? parseRulesetJson(await file.text()) : undefined;
      if (!rule) {
        setError(t("settings.rulesets.importInvalid"));
        return;
      }
      const validation = validationError(rule, rules.length);
      if (validation) {
        setError(validation);
        return;
      }
      const id = nextId.current++;
      changeRules([...rules, toDraft(rule, id)]);
      setEditing(id);
    } catch {
      setError(t("settings.rulesets.importUnreadable"));
    } finally {
      setImporting(false);
    }
  }

  function exportRuleset(rule: RepositoryRefRule) {
    const url = URL.createObjectURL(new Blob([serializeRulesetJson(rule)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ruleset-${rule.name.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function save() {
    if (!settings || !canEdit || !changed || busy) return;
    if (rules.length > maxRules) {
      setError(t("settings.rulesets.limit", { max: maxRules }));
      return;
    }
    const validationErrors = payload.map(validationError);
    const editingIndex = rules.findIndex(rule => rule.id === editing);
    const invalidIndex = validationErrors[editingIndex] ? editingIndex : validationErrors.findIndex(Boolean);
    if (invalidIndex !== -1) {
      const id = rules[invalidIndex].id;
      setEditing(id);
      setInvalidRule(id);
      setError(validationErrors[invalidIndex]);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const result = await repositoryAPI.updateGeneralSettings(organization.id, repository, {
        ref_rules: payload, updated_at: settings.updated_at,
      });
      setSettings(result);
      setRules((result.ref_rules ?? []).map((rule, index) => toDraft(rule, rules[index]?.id ?? nextId.current++)));
      setEditing(undefined);
      setSaved(true);
    } catch (cause) {
      setError(translateError(cause, t, "repositories:sections.settingsFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <div className="repo-settings-card">
    <p role="alert" className="org-error">{loadError}</p>
    <Button onClick={() => { setLoadError(""); setRetry(current => current + 1); }}>{t("app:organizationGate.retry")}</Button>
  </div>;
  if (!settings) return <p role="status">{t("common:components.loading")}</p>;

  return <form className="repo-settings-rulesets" aria-busy={busy} noValidate
    onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="repo-settings-card">
      <p>{t("settings.rulesets.help")}</p>
      {settings.hosting_kind === "registered" && <p>{t("settings.rulesets.hostedOnly")}</p>}
      {!canManage && <p>{t("sections.settingsDenied")}</p>}
      {canEdit && <div className="repo-settings-controls">
        <Button ref={addButton} disabled={busy || rules.length >= maxRules} onClick={addRule}>
          {t("settings.rulesets.add")}
        </Button>
        <Button disabled={busy || rules.length >= maxRules} onClick={() => fileInput.current?.click()}>
          {t("settings.rulesets.import")}
        </Button>
        <div hidden>
          <Input ref={fileInput} type="file" accept=".json,application/json" disabled={busy || rules.length >= maxRules}
            aria-label={t("settings.rulesets.importFile")} onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importRuleset(file);
            }} />
        </div>
      </div>}
      {canEdit && rules.length >= maxRules && <p>{t("settings.rulesets.limit", { max: maxRules })}</p>}
    </div>
    {!rules.length && <div className="repo-settings-card"><p>{t("settings.rulesets.empty")}</p></div>}
    {rules.map(rule => {
      const name = rule.name.trim() || t("settings.rulesets.untitled");
      const isEditing = canEdit && editing === rule.id;
      const isInvalid = invalidRule === rule.id;
      const currentRule = toRule(rule);
      const canExport = baseline.some(item => JSON.stringify(item) === JSON.stringify(currentRule));
      return <section key={rule.id} className="repo-settings-card" aria-label={name}>
        <div className="repo-settings-rule-header">
          <div>
            <h2>{name}</h2>
            <p>{rule.target === "branch" ? t("settings.rulesets.branch") : t("settings.rulesets.tag")} · {rule.enabled ? t("settings.rulesets.enabled") : t("settings.rulesets.disabled")}</p>
          </div>
          {canEdit && <div className="repo-settings-controls">
            <Button disabled={busy} aria-expanded={isEditing}
              aria-label={isEditing ? t("settings.rulesets.closeNamed", { name }) : t("settings.rulesets.editNamed", { name })}
              onClick={() => setEditing(isEditing ? undefined : rule.id)}>
              {isEditing ? t("common:actions.close") : t("common:actions.edit")}
            </Button>
            {canExport && <Button disabled={busy} aria-label={t("settings.rulesets.exportNamed", { name })}
              onClick={() => exportRuleset(currentRule)}>{t("settings.rulesets.export")}</Button>}
            <Button disabled={busy} aria-label={t("settings.rulesets.removeNamed", { name })}
              onClick={() => {
                if (editing === rule.id) setEditing(undefined);
                focusAdd.current = true;
                changeRules(rules.filter(item => item.id !== rule.id));
              }}>
              {t("settings.rulesets.remove")}
            </Button>
          </div>}
        </div>
        {isEditing ? <>
          {isInvalid && <p id={errorId} ref={validationAlert} role="alert" tabIndex={-1} className="org-error">{error}</p>}
          <RulesetEditor rule={rule} busy={busy} errorId={isInvalid ? errorId : undefined}
            onChange={patch => changeRules(rules.map(item => item.id === rule.id ? { ...item, ...patch } : item))} />
        </> : <dl className="repo-settings-rule-summary">
          <dt>{t("settings.rulesets.include")}</dt><dd>{patterns(rule.include).join(", ") || t("settings.rulesets.none")}</dd>
          <dt>{t("settings.rulesets.exclude")}</dt><dd>{patterns(rule.exclude).join(", ") || t("settings.rulesets.none")}</dd>
          <dt>{t("settings.rulesets.restrictions")}</dt>
          <dd>{restrictions.filter(key => rule[key]).map(key => t(restrictionLabels[key])).join(", ") || t("settings.rulesets.none")}</dd>
          {Boolean(rule.name_patterns?.length) && <>
            <dt>{t("settings.rulesets.namePatterns")}</dt>
            <dd>{rule.name_patterns?.map(({ operator, pattern, name, negate }) => t(
              negate ? "settings.rulesets.namePatternNegativeSummary" : "settings.rulesets.namePatternSummary",
              { operator: t(`settings.rulesets.nameOperators.${operator}`), pattern, description: name ? ` (${name})` : "" },
            )).join(", ")}</dd>
          </>}
        </dl>}
      </section>;
    })}
    {canEdit && <div className="repo-settings-controls">
      <Button type="submit" variant="primary" loading={saving} disabled={busy || !changed}>{t("settings.rulesets.save")}</Button>
    </div>}
    {saved && <p role="status">{t("settings.rulesets.saved")}</p>}
    {error && (invalidRule === undefined || editing !== invalidRule || !canEdit) && <p role="alert" className="org-error">{error}</p>}
  </form>;
}

function RulesetEditor({ rule, busy, errorId, onChange }: {
  rule: RuleDraft;
  busy: boolean;
  errorId?: string;
  onChange: (patch: Partial<Omit<RuleDraft, "id">>) => void;
}) {
  const { t } = useTranslation("repositories");
  return <div className="repo-settings-rule-editor" role="group" aria-label={t("settings.rulesets.editor")} aria-describedby={errorId}>
    <div className="repo-settings-rule-fields">
      <Input autoFocus={!errorId} label={t("settings.rulesets.name")} aria-label={t("settings.rulesets.name")} value={rule.name} required disabled={busy}
        hint={t("settings.rulesets.nameHint", { max: maxNameLength })} onChange={event => onChange({ name: event.target.value })} />
      <Select label={t("settings.rulesets.target")} value={rule.target} disabled={busy}
        options={[
          { value: "branch", label: t("settings.rulesets.branch") },
          { value: "tag", label: t("settings.rulesets.tag") },
        ]}
        onChange={event => onChange(event.target.value === "tag" ? { target: "tag", block_force_push: false, require_pull_request: false, require_merge_queue: false, require_linear_history: false } : { target: "branch" })} />
    </div>
    <Checkbox label={t("settings.rulesets.active")} checked={rule.enabled} disabled={busy} onChange={event => onChange({ enabled: event.target.checked })} />
    <div className="repo-settings-rule-fields">
      <TextArea label={t("settings.rulesets.include")} aria-label={t("settings.rulesets.include")} rows={3} value={rule.include} required disabled={busy}
        hint={t("settings.rulesets.patternsHelp", { max: maxPatterns })} onChange={event => onChange({ include: event.target.value })} />
      <TextArea label={t("settings.rulesets.exclude")} aria-label={t("settings.rulesets.exclude")} rows={3} value={rule.exclude} disabled={busy}
        hint={t("settings.rulesets.excludeHint")} onChange={event => onChange({ exclude: event.target.value })} />
    </div>
    <fieldset className="repo-settings-rule-restrictions">
      <legend>{t("settings.rulesets.restrictions")}</legend>
      {restrictions.map(key => rule.target === "tag" && (key === "block_force_push" || key === "require_pull_request" || key === "require_merge_queue" || key === "require_linear_history") ? null :
        <Checkbox key={key} label={t(restrictionLabels[key])} checked={Boolean(rule[key])} disabled={busy}
          onChange={event => onChange({ [key]: event.target.checked })} />)}
      {rule.require_linear_history && <p>{t("settings.rulesets.linearHistoryHelp")}</p>}
      {rule.require_merge_queue && <p>{t("settings.rulesets.mergeQueueHelp")}</p>}
    </fieldset>
    <fieldset className="repo-settings-rule-restrictions">
      <legend>{t("settings.rulesets.namePatterns")}</legend>
      {(rule.name_patterns ?? []).map((pattern, index, patterns) => {
        const update = (patch: Partial<RefNamePattern>) => onChange({
          name_patterns: patterns.map((item, i) => i === index ? { ...item, ...patch } : item),
        });
        return <div key={index} className="repo-settings-card" role="group" aria-label={t("settings.rulesets.namePatternItem", { number: index + 1 })}>
          <div className="repo-settings-rule-fields">
            <Select label={t("settings.rulesets.namePatternOperator")} value={pattern.operator} disabled={busy}
              options={namePatternOperators.map(operator => ({ value: operator, label: t(`settings.rulesets.nameOperators.${operator}`) }))}
              onChange={event => {
                const operator = namePatternOperators.find(item => item === event.target.value);
                if (operator) update({ operator });
              }} />
            <Input label={t("settings.rulesets.namePatternValue")} aria-label={t("settings.rulesets.namePatternValue")} value={pattern.pattern} maxLength={maxNamePatternBytes} disabled={busy}
              hint={t(pattern.operator === "regex" ? "settings.rulesets.namePatternRegexHint" : "settings.rulesets.namePatternLiteralHint")}
              onChange={event => update({ pattern: event.target.value })} />
          </div>
          <Input label={t("settings.rulesets.namePatternDescription")} value={pattern.name ?? ""} maxLength={maxNameLength} disabled={busy}
            onChange={event => update({ name: event.target.value })} />
          <Checkbox label={t("settings.rulesets.namePatternNegate")} checked={Boolean(pattern.negate)} disabled={busy}
            onChange={event => update({ negate: event.target.checked })} />
          <Button type="button" disabled={busy} onClick={() => onChange({ name_patterns: patterns.filter((_, i) => i !== index) })}>
            {t("settings.rulesets.removeNamePattern")}
          </Button>
        </div>;
      })}
      <div className="repo-settings-controls"><Button type="button" disabled={busy || (rule.name_patterns?.length ?? 0) >= maxNamePatterns}
        onClick={() => onChange({ name_patterns: [...(rule.name_patterns ?? []), { operator: "starts_with", pattern: "" }] })}>
        {t("settings.rulesets.addNamePattern")}
      </Button></div>
    </fieldset>
  </div>;
}
