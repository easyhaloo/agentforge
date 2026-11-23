import "@github/markdown-toolbar-element";
import { subscribe as subscribeMarkdownPaste } from "@github/paste-markdown";
import { createElement, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bookmark, Bold, Code, Hash, Heading, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Paperclip, Quote, Strikethrough } from "lucide-react";
import { Button, Checkbox, Input, Modal, Popover, Tabs, TextArea } from "../../shared/ui";
import { issuesAPI, type Issue, type UploadedIssueAttachment } from "../../shared/api/issues";
import { APIError, translateError } from "../../shared/api/errors";
import type { OrganizationSummary } from "../../shared/api/identity";
import { issueCreatePath, issueDetailPath, issueTemplatePath, organizationHandle, repositoryPath } from "../../shared/routing";
import { useIssueBodySuggestions } from "./IssueBodySuggestions";
import { IssueCreateMetadata, prefillIssueMetadata, type IssueMetadata } from "./IssueCreateMetadata";
import { IssueMarkdown } from "./IssueMarkdown";
import { IssueSavedReplies } from "./IssueSavedReplies";
import { IssueFormFields } from "./IssueFormFields";
import { initialIssueForm, missingIssueFormFields, renderIssueForm, type IssueTemplate } from "./issueTemplates";
import "./repositories.css";

const titleLimit = 500;
const bodyLimit = 65536;
const attachmentLimit = 20;
const emptyMetadata: IssueMetadata = { assignees: [], label_ids: [], milestone_id: "", issue_type: "", project_ids: [] };
const formats = [
  { key: "heading", icon: Heading, style: "header-2" },
  { key: "bold", icon: Bold, style: "bold", shortcut: "b" },
  { key: "italic", icon: Italic, style: "italic", shortcut: "i" },
  { key: "strikethrough", icon: Strikethrough, style: "strikethrough" },
  { key: "quote", icon: Quote, style: "quote", shortcut: "Period" },
  { key: "code", icon: Code, style: "code", shortcut: "e" },
  { key: "link", icon: LinkIcon, style: "link", shortcut: "k" },
  { key: "bullet", icon: List, style: "unordered-list", shortcut: "Digit8" },
  { key: "ordered", icon: ListOrdered, style: "ordered-list", shortcut: "Digit7" },
  { key: "task", icon: ListChecks, style: "task-list" },
] as const;

type EditorTab = "write" | "preview";

export interface IssueCreatePageProps {
  organization: OrganizationSummary;
  owner: string;
  repo: string;
  currentUser: string;
  onNotify: (message: string) => void;
  template?: IssueTemplate;
}

export function IssueCreatePage({ organization, owner, repo, currentUser, onNotify, template }: IssueCreatePageProps) {
  const { t } = useTranslation("repositories");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const repository = `${owner}/${repo}`;
  const handle = organizationHandle(organization);
  const defaultTitle = (template?.title ?? "").slice(0, titleLimit);
  const defaultDescription = (template?.body ?? "").slice(0, bodyLimit);
  const [title, setTitle] = useState(() => searchParams.get("title")?.slice(0, titleLimit) ?? defaultTitle);
  const [description, setBody] = useState(() => searchParams.get("body")?.slice(0, bodyLimit) ?? defaultDescription);
  const fields = template?.fields;
  const [defaultAnswers] = useState(() => initialIssueForm(fields ?? [], undefined, bodyLimit));
  const [answers, setAnswers] = useState(() => initialIssueForm(fields ?? [], searchParams, bodyLimit));
  const answerBaseline = useRef(answers);
  const [validateForm, setValidateForm] = useState(false);
  const body = fields ? [renderIssueForm(fields, answers, t("issues.templates.noResponse")), description].filter(Boolean).join("\n\n") : description;
  const invalidFields = validateForm && fields ? missingIssueFormFields(fields, answers) : [];
  const [duplicates, setDuplicates] = useState<{ query: string; items: Issue[] }>();
  const [metadata, setMetadata] = useState(emptyMetadata);
  const defaultMetadata = useRef(emptyMetadata);
  const [metadataParams, setMetadataParams] = useState(() => {
    const parameters = new URLSearchParams(template?.metadata);
    for (const key of ["labels", "assignees", "milestone", "type", "projects"]) {
      const value = searchParams.get(key);
      if (value !== null) parameters.set(key, value);
    }
    return [...parameters.values()].some((value) => value.trim()) ? parameters : undefined;
  });
  const [prefill, setPrefill] = useState<"loading" | "invalid" | "failed" | "ready">(metadataParams ? "loading" : "ready");
  const [prefillAttempt, setPrefillAttempt] = useState(0);
  const [tab, setTab] = useState<EditorTab>("write");
  const [createMore, setCreateMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [attachmentError, setAttachmentError] = useState("");
  const [attachments, setAttachments] = useState<UploadedIssueAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const published = useRef(false);
  const focusTitle = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusEditor = useRef(false);

  const [replySelection, setReplySelection] = useState<{ start: number; end: number }>();
  const completion = useIssueBodySuggestions(organization.id, repository, !fields && tab === "write" && !submitting && !uploading,
    setBody, setReplySelection);

  function insertReply(text: string) {
    const field = bodyRef.current;
    if (!field || !replySelection) return false;
    const { start, end } = replySelection;
    if (field.value.length - (end - start) + text.length > bodyLimit) return false;
    setReplySelection(undefined);
    requestAnimationFrame(() => {
      if (!field.isConnected) return;
      const before = field.value;
      field.focus();
      field.setSelectionRange(start, end);
      if (!field.ownerDocument.execCommand?.("insertText", false, text) || field.value === before) {
        field.setRangeText(text, start, end, "end");
      }
      setBody(field.value);
    });
    return true;
  }

  const duplicateQuery = body.trim().length >= 100 ? title.trim() : "";
  const suggestedIssues = duplicateQuery && duplicates?.query === duplicateQuery ? duplicates.items : [];
  const canSetMetadata = organization.role === "owner" || organization.role === "admin";
  const loadingMetadata = canSetMetadata && prefill === "loading";
  const metadataCount = metadata.assignees.length + metadata.label_ids.length + metadata.project_ids.length + Number(Boolean(metadata.milestone_id)) + Number(Boolean(metadata.issue_type));
  const editedAnswers = fields?.some((_, index) =>
    JSON.stringify(answers[index]?.filter(Boolean) ?? []) !== JSON.stringify(answerBaseline.current[index]?.filter(Boolean) ?? []),
  );
  const editedMetadata = template ? JSON.stringify(metadata) !== JSON.stringify(defaultMetadata.current) : metadataCount > 0;
  const dirty = title !== defaultTitle || description !== defaultDescription || editedAnswers || editedMetadata;
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !published.current && (dirty || submittingRef.current || uploadingRef.current) && (
      currentLocation.pathname !== nextLocation.pathname ||
      new URLSearchParams(currentLocation.search).get("template") !== new URLSearchParams(nextLocation.search).get("template")
    ),
  );
  useBeforeUnload((event) => {
    if (!dirty && !submittingRef.current && !uploadingRef.current) return;
    event.preventDefault();
    event.returnValue = true;
  });

  useEffect(() => {
    if (!submitting && focusTitle.current) {
      focusTitle.current = false;
      titleRef.current?.focus();
    }
  }, [submitting]);

  useEffect(() => {
    if (!focusEditor.current) return;
    focusEditor.current = false;
    (tab === "preview" ? panelRef.current : bodyRef.current)?.focus();
  }, [tab]);

  useEffect(() => {
    const field = bodyRef.current;
    if (!field) return;
    const subscription = subscribeMarkdownPaste(field);
    // When native insertion is unavailable, the paste library emits change instead of input.
    const syncPaste = () => field.dispatchEvent(new Event("input", { bubbles: true }));
    field.addEventListener("change", syncPaste);
    return () => {
      subscription.unsubscribe();
      field.removeEventListener("change", syncPaste);
    };
  }, []);

  useEffect(() => {
    if (!duplicateQuery) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      issuesAPI.list(organization.id, { repository, q: duplicateQuery, limit: 3 }, controller.signal)
        .then(({ items }) => {
          if (!controller.signal.aborted) setDuplicates({ query: duplicateQuery, items });
        })
        .catch(() => { /* Suggestions are optional and do not affect the draft. */ });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [organization.id, repository, duplicateQuery]);

  useEffect(() => {
    if (!metadataParams || !canSetMetadata) return;
    let current = true;
    prefillIssueMetadata(organization.id, handle, owner, repo, metadataParams).then((selection) => {
      if (!current) return;
      if (selection) {
        defaultMetadata.current = selection;
        setMetadata(selection);
      }
      setPrefill(selection ? "ready" : "invalid");
    }).catch(() => {
      if (current) setPrefill("failed");
    });
    return () => { current = false; };
  }, [metadataParams, canSetMetadata, organization.id, handle, owner, repo, prefillAttempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || submittingRef.current || uploadingRef.current || loadingMetadata) return;
    if (fields) {
      const [missing] = missingIssueFormFields(fields, answers);
      if (missing !== undefined) {
        setValidateForm(true);
        setTab("write");
        requestAnimationFrame(() => document.getElementById(`issue-form-field-${missing}`)?.focus());
        return;
      }
    }
    if (body.length > bodyLimit) {
      setError(t("issues.templates.bodyLimit", { count: bodyLimit }));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const attachmentIDs = attachments.filter(({ url }) => body.includes(`](${url})`)).map(({ id }) => id);
      const issue = await issuesAPI.create(organization.id, {
        repository, title: title.trim(), body, ...(canSetMetadata ? metadata : {}),
        ...(attachmentIDs.length ? { attachment_ids: attachmentIDs } : {}),
      });
      onNotify(t("issues.createSuccess"));
      if (createMore) {
        if (searchParams.size) {
          const next = template ? `?${new URLSearchParams({ template: template.filename })}` : "";
          navigate(issueCreatePath(handle, repository) + next, { replace: true });
        }
        answerBaseline.current = defaultAnswers;
        setTitle(defaultTitle);
        setBody(defaultDescription);
        setAnswers(defaultAnswers);
        setValidateForm(false);
        setDuplicates(undefined);
        defaultMetadata.current = emptyMetadata;
        setMetadata(emptyMetadata);
        const templateParams = template?.metadata.size ? new URLSearchParams(template.metadata) : undefined;
        setMetadataParams(templateParams);
        setPrefill(templateParams ? "loading" : "ready");
        setAttachments([]);
        setAttachmentError("");
        setTab("write");
        focusTitle.current = true;
      } else {
        published.current = true;
        navigate(issueDetailPath(handle, repository, issue.number), { replace: true });
      }
    } catch (cause) {
      setError(translateError(cause, t, "repositories:issues.createFailed"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function attach(files: File[], fieldIndex?: number) {
    if (!files.length || uploadingRef.current || submittingRef.current) return;
    const remaining = attachmentLimit - attachments.filter(({ url }) => body.includes(`](${url})`)).length;
    if (files.length > remaining) {
      setAttachmentError(t("issues.composer.attachmentLimit", { count: attachmentLimit }));
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setAttachmentError("");
    const field = fieldIndex === undefined ? undefined : fields?.[fieldIndex];
    const accepted = field?.type === "upload" ? field.accept.split(",").map((extension) => extension.trim().toLowerCase()).filter(Boolean) : [];
    const cursor = tab === "write" ? bodyRef.current?.selectionEnd ?? description.length : description.length;
    const inserted: UploadedIssueAttachment[] = [];
    const lines: string[] = [];
    const before = description.slice(0, cursor);
    const after = description.slice(cursor);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    try {
      for (const file of files) {
        if (accepted.length && !accepted.some((extension) => extension.startsWith(".") && file.name.toLowerCase().endsWith(extension))) {
          setAttachmentError(t("issues.composer.attachmentUnsupported", { name: file.name }));
          continue;
        }
        try {
          const attachment = await issuesAPI.uploadAttachment(organization.id, repository, file);
          const name = attachment.name.replace(/[\\\[\]]/g, "\\$&");
          const line = `${attachment.image ? "!" : ""}[${name}](${attachment.url})\n`;
          if (body.length + prefix.length + lines.join("").length + line.length > bodyLimit) {
            setAttachmentError(t("issues.composer.attachmentBodyLimit"));
            break;
          }
          inserted.push(attachment);
          lines.push(line);
        } catch (cause) {
          const reason = cause instanceof APIError ? cause.status : 0;
          setAttachmentError(t(reason === 413 ? "issues.composer.attachmentTooLarge" : reason === 415 || reason === 422
            ? "issues.composer.attachmentUnsupported" : "issues.composer.attachmentFailed", { name: file.name }));
        }
      }
      if (lines.length) {
        setAttachments((previous) => [...previous, ...inserted]);
        if (fieldIndex === undefined) setBody(before + prefix + lines.join("") + after);
        else setAnswers((previous) => ({ ...previous, [fieldIndex]: [...(previous[fieldIndex] ?? []), ...lines.map((line) => line.trimEnd())] }));
      }
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  return (
    <section className="issue-create" aria-labelledby="issue-create-heading">
      <h1 id="issue-create-heading">{t("issues.newIssue")}</h1>
      {template && <p className="issue-template-current">
        <span>{template.name || t("issues.templates.legacyName")}</span>
        <Link to={issueTemplatePath(handle, repository)}>{t("issues.templates.change")}</Link>
      </p>}
      <form onSubmit={submit} aria-busy={submitting || uploading} onKeyDown={(event) => {
        if (!event.defaultPrevented && event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}>
        {error && <div className="org-error" role="alert">{error}</div>}
        <label htmlFor="issue-new-title">{t("issues.form.title")} <span aria-hidden="true">*</span></label>
        <Input ref={titleRef} id="issue-new-title" autoFocus required disabled={submitting} maxLength={titleLimit}
          value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("issues.form.titlePlaceholder")} />
        {invalidFields.length > 0 && <p id="issue-form-required" role="alert">{t("issues.templates.requiredFields", {
          fields: invalidFields.map((index) => {
            const field = fields?.[index];
            return field && field.type !== "markdown" ? field.label : "";
          }).join(", "),
        })}</p>}
        {!fields && <label htmlFor={tab === "write" ? "issue-new-body" : undefined}>{t("issues.form.body")}</label>}
        <div className="issue-composer" onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey
            || (!event.ctrlKey && !event.metaKey) || uploadingRef.current || submittingRef.current) return;
          if (event.shiftKey && event.key.toLowerCase() === "p") {
            completion.close();
            event.preventDefault();
            if (!event.repeat) {
              focusEditor.current = true;
              setTab(tab === "write" ? "preview" : "write");
            }
            return;
          }
          if (event.target !== bodyRef.current) return;
          const shortcut = event.shiftKey ? event.code : event.key.toLowerCase();
          const format = formats.find((item) => "shortcut" in item && item.shortcut === shortcut);
          if (!format) return;
          event.preventDefault();
          if (!event.repeat) event.currentTarget.querySelector<HTMLButtonElement>(`[data-md-button="${format.style}"]`)?.click();
        }}>
          <div className="issue-composer__header">
            <Tabs id="issue-composer" className="issue-composer__tabs" ariaLabel={t("issues.form.body")}
              value={tab} onChange={(key) => {
                completion.close();
                setTab(key === "preview" ? "preview" : "write");
              }}
              items={(["write", "preview"] as const).map((key) => ({ key, label: t(`issues.composer.${key}`), disabled: submitting || uploading }))} />
            {!fields && tab === "write" && <div className="issue-composer__formats">{createElement("markdown-toolbar", {
              className: "issue-composer__formats",
              for: "issue-new-body",
              "aria-label": t("issues.composer.formatting"),
            }, [...formats.map(({ icon: Icon, key, style }) => (
              <Button key={key} type="button" variant="ghost" size="small" disabled={submitting || uploading}
                title={t(`issues.composer.${key}`)} aria-label={t(`issues.composer.${key}`)} data-md-button={style}>
                <Icon size={16} aria-hidden="true" />
              </Button>
            )), <Button key="reference" type="button" variant="ghost" size="small" data-md-button="reference" disabled={submitting || uploading}
              title={t("issues.composer.reference")} aria-label={t("issues.composer.reference")}
              onClick={() => { if (bodyRef.current) completion.insertReference(bodyRef.current); }}>
              <Hash size={16} aria-hidden="true" />
            </Button>])}
              <Button variant="ghost" size="small" disabled={submitting || uploading} aria-haspopup="dialog"
                title={t("settings:savedReplies.title")} aria-label={t("settings:savedReplies.title")} onClick={() => {
                  const field = bodyRef.current;
                  if (field) setReplySelection({ start: field.selectionStart, end: field.selectionEnd });
                }}><Bookmark size={16} aria-hidden="true" /></Button>
            </div>}
          </div>
          <div ref={panelRef} role="tabpanel" id="issue-composer-panel" aria-labelledby={`issue-composer-tab-${tab}`}
            className={tab === "preview" ? "issue-composer__preview" : undefined} tabIndex={tab === "preview" ? 0 : undefined}>
            <div hidden={tab !== "write"}>
              {fields ? <IssueFormFields fields={fields} values={answers} invalid={invalidFields} disabled={submitting || uploading}
                organizationID={organization.id} handle={handle} repository={repository}
                onChange={(index, values) => setAnswers((previous) => ({ ...previous, [index]: values }))}
                onAttach={(files, index) => { void attach(files, index); }} /> : <>
              <TextArea {...completion.inputProps} ref={bodyRef} id="issue-new-body" value={body} disabled={submitting || uploading} maxLength={bodyLimit} rows={12}
                onInput={(event) => {
                  const field = event.currentTarget;
                  // The toolbar can assign the DOM value directly in browsers without native insertText.
                  if (field.value.length > bodyLimit) field.value = body;
                  else {
                    setBody(field.value);
                    if (!(event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing)) completion.select(field);
                  }
                }}
                placeholder={t("issues.form.bodyPlaceholder")}
                onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
                onDrop={(event) => {
                  const files = Array.from(event.dataTransfer.files);
                  if (!files.length) return;
                  event.preventDefault();
                  void attach(files);
                }}
                onPasteCapture={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (!files.length) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void attach(files);
                }} />
              {completion.menu}
              </>}
            </div>
            {tab === "preview" && (body.trim() ? <IssueMarkdown content={body} organizationID={organization.id} handle={handle} repository={repository} /> : <p>{t("issues.composer.emptyPreview")}</p>)}
          </div>
          <div className="issue-composer__attachments">
            {!fields && <><div hidden>
              <Input ref={fileRef} type="file" multiple onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void attach(files);
              }} />
            </div>
            <Button type="button" variant="ghost" size="small" disabled={submitting || uploading}
              onClick={() => fileRef.current?.click()}>
              <Paperclip size={16} aria-hidden="true" /> {t("issues.composer.attachFiles")}
            </Button></>}
            {uploading && <span role="status">{t("issues.composer.uploading")}</span>}
          </div>
          {attachmentError && <p className="org-error" role="alert">{attachmentError}</p>}
        </div>
        {suggestedIssues.length > 0 && <section className="issue-create__suggestions" aria-labelledby="issue-suggestions-title">
          <h2 id="issue-suggestions-title">{t("issues.composer.potentialDuplicates")}</h2>
          <ul>{suggestedIssues.map((issue) => <li key={issue.id}>
            <Link to={issueDetailPath(handle, repository, issue.number)}>{issue.title} #{issue.number}</Link>
          </li>)}</ul>
        </section>}
        {loadingMetadata && <p role="status">{t("common:components.loading")}</p>}
        {metadataParams && searchParams.size > 0 && (!canSetMetadata || prefill === "invalid") && <p role="alert">{t("issues.composer.prefillUnavailable")}</p>}
        {canSetMetadata && prefill === "failed" && <div>
          <p role="alert">{t("issues.composer.prefillUnavailable")}</p>
          <Button type="button" variant="secondary" disabled={submitting} onClick={() => {
            setPrefill("loading");
            setPrefillAttempt((attempt) => attempt + 1);
          }}>{t("issues.composer.retry")}</Button>
        </div>}
        {canSetMetadata && <fieldset className="issue-create__metadata" disabled={submitting || loadingMetadata}>
          <Popover ariaLabel={t("issues.composer.metadata")} trigger={
            `${t("issues.composer.metadata")}${metadataCount ? ` (${metadataCount})` : ""}`
          }>
            <IssueCreateMetadata organizationID={organization.id} owner={owner} repo={repo}
              value={metadata} onChange={setMetadata} />
          </Popover>
          {currentUser && !metadata.assignees.includes(currentUser) && (
            <Button type="button" variant="ghost" size="small" onClick={() => {
              setMetadata((current) => ({ ...current, assignees: [...current.assignees, currentUser] }));
            }}>
              {t("issues.composer.assignYourself")}
            </Button>
          )}
        </fieldset>}
        <div className="issue-create__actions">
          <Checkbox label={t("issues.composer.createMore")} checked={createMore} disabled={submitting}
            onChange={(event) => setCreateMore(event.target.checked)} />
          <Button type="button" variant="secondary" disabled={submitting} onClick={() => navigate(repositoryPath(handle, repository, "issues"))}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || uploading || loadingMetadata || !title.trim()} aria-keyshortcuts="Meta+Enter Control+Enter">
            {submitting ? t("common:components.loading") : t("issues.form.createIssue")}
            {!submitting && <kbd aria-hidden="true">{navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl"}+↵</kbd>}
          </Button>
        </div>
      </form>
      {replySelection && <IssueSavedReplies onCancel={() => setReplySelection(undefined)} onInsert={insertReply} />}
      {blocker.state === "blocked" && <Modal open title={t("issues.composer.discardTitle")} closeOnBackdrop={false}
        onCancel={blocker.reset} cancelText={t("issues.composer.keepEditing")} confirmLoading={submitting || uploading}
        onOk={blocker.proceed} okText={t("issues.composer.discard")} okVariant="danger">
        <p>{t("issues.composer.discardBody")}</p>
      </Modal>}
    </section>
  );
}
