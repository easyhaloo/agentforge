import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { APIError, translateError } from "../../shared/api/errors";
import {
  projectFieldsAPI, projectFieldTypes, type ProjectField, type ProjectFieldDefinitionInput,
  type ProjectFieldDefinitions, type ProjectFieldType, type ProjectFieldValue, type ProjectItemFieldValues,
} from "../../shared/api/projectFields";
import { Button, ConfirmDialog, Input, Select } from "../../shared/ui";

const primaryLink = "af-button af-button--primary af-button--middle";
const secondaryLink = "af-button af-button--secondary af-button--middle";

type ProjectFieldScope = { orgID: string; projectNumber: number; onRefresh: () => void };

export type ProjectFieldSettingsProps = ProjectFieldScope & {
  projectVersion: number;
  canManage: boolean;
  fieldsURL: string;
  fieldID?: string;
  onProjectVersionChange: (version: number) => void;
};

export type ProjectItemFieldEditorProps = ProjectFieldScope & {
  itemID: string;
  itemVersion: number;
  canEdit: boolean;
  onItemVersionChange: (version: number) => void;
};

function fieldURL(fieldsURL: string, fieldID: string) {
  const [path, query] = fieldsURL.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("field", fieldID);
  return `${path}?${params.toString()}`;
}

function FieldLoading({ failed, retry }: { failed: boolean; retry: () => void }) {
  const { t } = useTranslation("projectFields");
  return failed ? <div className="projects-toolbar">
    <p role="alert">{t("loadFailed")}</p>
    <Button onClick={retry}>{t("retry")}</Button>
  </div> : <p role="status">{t("common:components.loading")}</p>;
}

function StaleVersion({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation("projectFields");
  return <div className="projects-toolbar">
    <p role="alert">{t("stale")}</p>
    <Button onClick={onRefresh}>{t("refresh")}</Button>
  </div>;
}

function isVersionConflict(cause: unknown) {
  return cause instanceof APIError && cause.status === 409 && cause.detail === "Refresh the project or item and try again";
}

export function ProjectFieldSettings(props: ProjectFieldSettingsProps) {
  return <ProjectFieldSettingsContent key={`${props.orgID}/${props.projectNumber}`} {...props} />;
}

function ProjectFieldSettingsContent({
  orgID, projectNumber, projectVersion, canManage, fieldsURL, fieldID, onProjectVersionChange, onRefresh,
}: ProjectFieldSettingsProps) {
  const { t } = useTranslation("projectFields");
  const headingID = useId();
  const navigate = useNavigate();
  const [definitions, setDefinitions] = useState<ProjectFieldDefinitions>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    projectFieldsAPI.list(orgID, projectNumber, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setDefinitions(data); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [orgID, projectNumber, projectVersion, attempt]);

  const stale = conflict || definitions?.project_version !== projectVersion;
  const selected = definitions?.fields.find(({ id }) => id === fieldID);
  const creating = fieldID === "new";
  function apply(saved: ProjectFieldDefinitions) {
    setDefinitions(saved);
    onProjectVersionChange(saved.project_version);
  }
  function refresh() {
    setDefinitions(undefined);
    setFailed(false);
    setConflict(false);
    setAttempt((value) => value + 1);
    onRefresh();
  }
  async function save(input: Omit<ProjectFieldDefinitionInput, "project_version">) {
    const payload = { ...input, project_version: projectVersion };
    try {
      const saved = selected
        ? await projectFieldsAPI.update(orgID, projectNumber, selected.id, payload)
        : await projectFieldsAPI.create(orgID, projectNumber, payload);
      apply(saved);
      void navigate(fieldsURL, { replace: true });
    } catch (cause) {
      if (isVersionConflict(cause)) setConflict(true);
      throw cause;
    }
  }
  async function remove() {
    if (!selected || deleting || stale || !canManage) return;
    setDeleting(true);
    try {
      apply(await projectFieldsAPI.remove(orgID, projectNumber, selected.id, projectVersion));
      setConfirmDelete(false);
      void navigate(fieldsURL, { replace: true });
    } catch (cause) {
      if (!isVersionConflict(cause)) throw cause;
      setConflict(true);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return <section className="projects-form" aria-labelledby={headingID}>
    <div className="projects-heading">
      <h2 id={headingID}>{t(creating ? "newField" : fieldID ? "editField" : "title")}</h2>
      {!fieldID && canManage && <Link className={primaryLink} to={fieldURL(fieldsURL, "new")}>{t("newField")}</Link>}
    </div>
    {!definitions ? <FieldLoading failed={failed} retry={() => { setFailed(false); setAttempt((value) => value + 1); }} /> : <>
      {canManage && stale && <StaleVersion onRefresh={refresh} />}
      {fieldID ? <>
        {(!creating && !selected) || !canManage ? <>
          <p role="alert">{t(!canManage ? "errors:forbidden" : "fieldNotFound")}</p>
          <div><Link className={secondaryLink} to={fieldsURL}>{t("cancel")}</Link></div>
        </> : <FieldDefinitionForm key={fieldID} field={selected} fieldsURL={fieldsURL} disabled={stale || deleting}
          onSave={save} onDelete={selected ? () => setConfirmDelete(true) : undefined} />}
      </> : definitions.fields.length ? <ul className="projects-directory">
        {definitions.fields.map((field) => <li key={field.id}>
          {canManage ? <Link to={fieldURL(fieldsURL, field.id)}>{field.name}</Link> : <strong>{field.name}</strong>}
          <span>{t(`types.${field.type}`)}</span>
        </li>)}
      </ul> : <p>{t("empty")}</p>}
    </>}
    {selected && <ConfirmDialog open={confirmDelete} danger title={t("deleteField")} confirmText={t("deleteField")}
      description={t("deleteConfirmation", { name: selected.name })} onCancel={() => setConfirmDelete(false)} onConfirm={remove} />}
  </section>;
}

type OptionDraft = ProjectFieldDefinitionInput["options"][number] & { key: number };

function FieldDefinitionForm({ field, fieldsURL, disabled, onSave, onDelete }: {
  field?: ProjectField;
  fieldsURL: string;
  disabled: boolean;
  onSave: (input: Omit<ProjectFieldDefinitionInput, "project_version">) => Promise<void>;
  onDelete?: () => void;
}) {
  const { t } = useTranslation("projectFields");
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<ProjectFieldType>(field?.type ?? "text");
  const [options, setOptions] = useState<OptionDraft[]>(() => field?.options.map((option, key) => ({ ...option, key })) ?? []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const usesOptions = type === "single_select" || type === "iteration";
  function changeType(value: string) {
    const next = projectFieldTypes.find((candidate) => candidate === value);
    if (!next) return;
    setType(next);
    if ((next === "single_select" || next === "iteration") && !options.length) setOptions([{ key: 0, name: "" }]);
  }
  function changeOption(key: number, patch: Partial<OptionDraft>) {
    setOptions((current) => current.map((option) => option.key === key ? { ...option, ...patch } : option));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy) return;
    const payloadOptions = usesOptions ? options.map((option) => ({
      id: option.id, name: option.name.trim(),
      ...(type === "iteration" ? { start_date: option.start_date, end_date: option.end_date } : {}),
    })) : [];
    if (!name.trim() || (usesOptions && (!payloadOptions.length || payloadOptions.some((option) => !option.name ||
      (type === "iteration" && (!option.start_date || !option.end_date || option.start_date > option.end_date))) ||
      new Set(payloadOptions.map((option) => option.name.toLowerCase())).size !== payloadOptions.length))) {
      setSaveError(t("invalidDefinition"));
      return;
    }
    setBusy(true);
    setSaveError("");
    try {
      await onSave({ name: name.trim(), type, options: payloadOptions });
    } catch (cause) {
      if (!isVersionConflict(cause)) setSaveError(translateError(cause, t, "saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <form className="projects-form" onSubmit={submit}>
    <fieldset className="projects-fields" disabled={disabled || busy}>
      <Input label={t("name")} value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} />
      <Select label={t("type")} value={type} disabled={Boolean(field) || disabled || busy}
        options={projectFieldTypes.map((value) => ({ value, label: t(`types.${value}`) }))}
        onChange={(event) => changeType(event.target.value)} />
      {usesOptions && <fieldset className="projects-fields">
        <legend>{t(type === "iteration" ? "periods" : "options")}</legend>
        {options.map((option, index) => <div className="projects-fields" key={option.key}>
          <Input label={t("optionName", { number: index + 1 })} required maxLength={100} value={option.name}
            onChange={(event) => changeOption(option.key, { name: event.target.value })} />
          {type === "iteration" && <div className="projects-toolbar">
            <Input type="date" label={t("startDate")} required value={option.start_date ?? ""}
              onChange={(event) => changeOption(option.key, { start_date: event.target.value })} />
            <Input type="date" label={t("endDate")} required value={option.end_date ?? ""} min={option.start_date}
              onChange={(event) => changeOption(option.key, { end_date: event.target.value })} />
          </div>}
          <div><Button size="small" disabled={options.length <= 1} onClick={() => setOptions((current) => current.filter(({ key }) => key !== option.key))}>
            {t("removeOption", { number: index + 1 })}
          </Button></div>
        </div>)}
        <div><Button size="small" disabled={options.length >= 50}
          onClick={() => setOptions((current) => [...current, { key: (current.at(-1)?.key ?? -1) + 1, name: "" }])}>
          {t("addOption")}
        </Button></div>
      </fieldset>}
    </fieldset>
    {saveError && <p role="alert" className="projects-error">{saveError}</p>}
    <div className="projects-actions">
      <Button type="submit" variant="primary" loading={busy} disabled={disabled}>{t("save")}</Button>
      <Link className={secondaryLink} to={fieldsURL}>{t("cancel")}</Link>
      {onDelete && <Button variant="danger" disabled={disabled || busy} onClick={onDelete}>{t("deleteField")}</Button>}
    </div>
  </form>;
}

export function ProjectItemFieldEditor(props: ProjectItemFieldEditorProps) {
  return <ProjectItemFieldEditorContent key={`${props.orgID}/${props.projectNumber}/${props.itemID}`} {...props} />;
}

function ProjectItemFieldEditorContent({
  orgID, projectNumber, itemID, itemVersion, canEdit, onItemVersionChange, onRefresh,
}: ProjectItemFieldEditorProps) {
  const { t } = useTranslation("projectFields");
  const headingID = useId();
  const [fields, setFields] = useState<ProjectField[]>();
  const [data, setData] = useState<ProjectItemFieldValues>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState("");
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([projectFieldsAPI.list(orgID, projectNumber, controller.signal), projectFieldsAPI.values(orgID, projectNumber, itemID, controller.signal)]).then(
      ([definitions, values]) => { if (!controller.signal.aborted) { setFields(definitions.fields); setData(values); } },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [orgID, projectNumber, itemID, itemVersion, attempt]);

  const stale = conflict || itemVersion !== data?.item_version;
  function refresh() {
    setData(undefined);
    setFailed(false);
    setConflict(false);
    setError("");
    setAttempt((value) => value + 1);
    onRefresh();
  }
  async function save(fieldID: string, value: ProjectFieldValue | null) {
    if (!canEdit || stale || pending) return;
    setPending(fieldID);
    setError("");
    try {
      const saved = await projectFieldsAPI.setValue(orgID, projectNumber, itemID, fieldID, itemVersion, value);
      setData(saved);
      onItemVersionChange(saved.item_version);
    } catch (cause) {
      if (isVersionConflict(cause)) setConflict(true);
      else setError(translateError(cause, t, "saveFailed"));
    } finally {
      setPending("");
    }
  }

  return <section className="projects-form" aria-labelledby={headingID}>
    <h2 id={headingID}>{t("title")}</h2>
    {!fields || !data ? <FieldLoading failed={failed} retry={() => { setFailed(false); setAttempt((value) => value + 1); }} /> : <>
      {canEdit && stale && <StaleVersion onRefresh={refresh} />}
      {error && <p role="alert" className="projects-error">{error}</p>}
      {!fields.length && <p>{t("empty")}</p>}
      {fields.map((field) => <FieldValueControl key={JSON.stringify([field.id, data.values[field.id]])} field={field} value={data.values[field.id]}
        readOnly={!canEdit} disabled={stale || Boolean(pending)} loading={pending === field.id} save={(value) => save(field.id, value)} />)}
    </>}
  </section>;
}

function FieldValueControl({ field, value, readOnly, disabled, loading, save }: {
  field: ProjectField;
  value: ProjectFieldValue | undefined;
  readOnly: boolean;
  disabled: boolean;
  loading: boolean;
  save: (value: ProjectFieldValue | null) => Promise<void>;
}) {
  const { t } = useTranslation("projectFields");
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState("");
  const usesOptions = field.type === "single_select" || field.type === "iteration";
  const options = field.options.map((option) => ({
    value: option.id, label: option.start_date && option.end_date
      ? `${option.name} (${t("range", { start: option.start_date, end: option.end_date })})` : option.name,
  }));
  if (readOnly) {
    const display = usesOptions ? options.find((option) => option.value === value)?.label : value;
    return <div><strong>{field.name}</strong><div>{display ?? t("unset")}</div></div>;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !draft) return;
    setError("");
    const next = field.type === "number" ? Number(draft) : draft;
    if (typeof next === "number" && !Number.isFinite(next)) {
      setError(t("invalidNumber"));
      return;
    }
    void save(next);
  }
  return <form className="projects-form" onSubmit={submit}>
    {usesOptions ? <Select label={field.name} options={options} placeholder={t("unset")} value={draft} disabled={disabled}
      onChange={(event) => setDraft(event.target.value)} /> :
      <Input label={field.name} type={field.type} step={field.type === "number" ? "any" : undefined} value={draft} disabled={disabled}
        maxLength={field.type === "text" ? 1000 : undefined} error={error} onChange={(event) => setDraft(event.target.value)} />}
    <div className="projects-toolbar">
      <Button size="small" type="submit" loading={loading} disabled={disabled || !draft || String(value ?? "") === draft} aria-label={t("saveValue", { name: field.name })}>{t("save")}</Button>
      {value !== undefined && <Button size="small" onClick={() => void save(null)} disabled={disabled}>{t("clearValue", { name: field.name })}</Button>}
    </div>
  </form>;
}
