import { nameToEmoji } from "gemoji";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { changesetAPI } from "../../shared/api/identity";
import { changesetPath, pullRequestPath } from "../../shared/routing";
import { issuesAPI } from "../../shared/api/issues";
import { githubEmojiNames, githubEmojiURL } from "./githubEmoji";
import { loadIssueTemplates } from "./issueTemplates";

const maxSuggestions = 6;
const emojiNames = [...Object.keys(nameToEmoji), ...githubEmojiNames];

type Token = { externalRepository?: string; trigger: "#" | "@" | ":" | "/"; query: string; start: number; end: number };
type CommandGroup = "alerts" | "table" | "templates";
type Suggestion = { label: string; detail?: string; id?: string; image?: string } & ({ insert: string } | { group: CommandGroup } | { savedReplies: true });
const alerts = ["note", "tip", "important", "warning", "caution"] as const;
type Lookup = { externalRepository?: string; trigger: "#" | "@"; query: string; items: Suggestion[]; failed?: boolean };

function tokenAtCaret(field: HTMLTextAreaElement): Token | null {
  const { value, selectionStart, selectionEnd } = field;
  if (selectionStart !== selectionEnd) return null;
  const before = value.slice(0, selectionStart);
  const qualified = /(?:^|[\s([{])([a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100})#([\p{L}\p{N}_.+-]*)$/iu.exec(before);
  if (qualified) {
    const [, externalRepository, query] = qualified;
    const start = selectionStart - externalRepository.length - query.length - 1;
    const end = selectionStart + (value.slice(selectionStart).match(/^[\p{L}\p{N}_.+-]*/u)?.[0].length ?? 0);
    return { trigger: "#", externalRepository, query, start, end };
  }
  const match = /(?:^|[\s([{])([#@:/])([\p{L}\p{N}_+-]*)$/u.exec(before);
  if (!match || match.index + match[0].length !== before.length) return null;
  const [, trigger, query] = match;
  if (trigger !== "#" && trigger !== "@" && trigger !== ":" && trigger !== "/") return null;
  const start = selectionStart - query.length - 1;
  if (trigger === "/" && (value[start + 1] === "/" || (start > 0 && !/\s/u.test(value[start - 1])))) return null;
  const tail = value.slice(selectionStart).match(/^[\p{L}\p{N}_+-]*/u)?.[0] ?? "";
  const end = selectionStart + tail.length;
  return { trigger, query, start, end: trigger === ":" && value[end] === ":" ? end + 1 : end };
}

export function useIssueBodySuggestions(organizationID: string, repository: string, enabled: boolean,
  onChange: (value: string) => void, onSavedReplies: (selection: { start: number; end: number }) => void) {
  const { t } = useTranslation("repositories");
  const listID = useId();
  const [token, setToken] = useState<Token | null>(null);
  const dismissed = useRef<Token | null>(null);
  const composing = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [commandGroup, setCommandGroup] = useState<CommandGroup>();
  const [lookup, setLookup] = useState<Lookup>();
  const [templateLookup, setTemplateLookup] = useState<{ items: Suggestion[]; failed?: boolean }>();
  const lookupTrigger = enabled && (token?.trigger === "#" || token?.trigger === "@") ? token.trigger : null;
  const lookupQuery = lookupTrigger ? token?.query : undefined;
  const externalRepository = lookupTrigger === "#" ? token?.externalRepository : undefined;
  const showTemplates = enabled && token?.trigger === "/" && commandGroup === "templates";

  useEffect(() => {
    if (!showTemplates) return;
    let active = true;
    loadIssueTemplates(organizationID, repository).then(({ templates }) => {
      if (!active) return;
      setTemplateLookup({ items: templates.filter((template) => !template.fields && template.body.trim()).map((template) => ({
        id: template.filename,
        label: template.name || t("issues.templates.legacyName"),
        detail: template.description,
        insert: template.body.trimEnd(),
      })) });
    }, () => {
      if (active) setTemplateLookup({ items: [], failed: true });
    });
    return () => { active = false; };
  }, [showTemplates, organizationID, repository, t]);

  useEffect(() => {
    if (!lookupTrigger || lookupQuery === undefined) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]);
      const lookupKey = { trigger: lookupTrigger, query: lookupQuery, externalRepository };
      try {
        let items: Suggestion[];
        if (lookupTrigger === "@") {
          const { items: members } = await issuesAPI.memberMentions(organizationID, lookupQuery, signal);
          items = (members ?? []).map(({ username, display_name }) => ({
            insert: `@${username}`, label: `@${username}`, detail: display_name,
          }));
        } else if (externalRepository) {
          const { items: pulls } = await issuesAPI.githubPullSearch(organizationID, externalRepository, lookupQuery, signal);
          items = pulls.map(({ number, title }) => ({
            insert: `https://github.com/${externalRepository}/pull/${number}`,
            label: t("issues.composer.pullReference", { number }), detail: title,
          }));
        } else {
          const byNumber = /^\d+$/.test(lookupQuery);
          const q = byNumber ? `#${lookupQuery}` : lookupQuery;
          const [issues, changesets] = await Promise.allSettled([
            issuesAPI.list(organizationID, { repository, q, limit: maxSuggestions }, signal),
            byNumber ? undefined : changesetAPI.list(organizationID, { repository, q, limit: 2 }, signal),
          ]);
          const changesetOptions = changesets.status === "fulfilled" ? (changesets.value?.items ?? []).flatMap(({ changeset }) => {
            const { id, title, pull_request: pullRequest } = changeset;
            if (!/^[a-f0-9-]+$/i.test(id)) return [];
            const label = t(pullRequest ? "issues.composer.localPullReference" : "issues.composer.changesetReference", { id: id.slice(0, 8) });
            const path = pullRequest ? pullRequestPath(organizationID, repository, id) : changesetPath(organizationID, id);
            return [{ id, label, detail: title, insert: `[${label}](<${path}>)` }];
          }) : [];
          const issueOptions = issues.status === "fulfilled" ? (issues.value.items ?? []).map(({ number, title }) => ({
            insert: `#${number}`, label: `#${number}`, detail: title,
          })) : [];
          items = [...issueOptions.slice(0, maxSuggestions - changesetOptions.length), ...changesetOptions];
          if (!items.length && (issues.status === "rejected" || changesets.status === "rejected")) {
            if (!controller.signal.aborted) setLookup({ ...lookupKey, items, failed: true });
            return;
          }
        }
        if (!controller.signal.aborted) setLookup({ ...lookupKey, items });
      } catch {
        if (!controller.signal.aborted) setLookup({ ...lookupKey, items: [], failed: true });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [lookupTrigger, lookupQuery, externalRepository, organizationID, repository, t]);

  const openToken = enabled ? token : null;
  const result = lookup?.trigger === lookupTrigger && lookup.query === lookupQuery
    && lookup.externalRepository === externalRepository ? lookup : undefined;
  const items: Suggestion[] = openToken?.trigger === ":"
    ? emojiNames.filter((name) => name.startsWith(openToken.query.toLowerCase())).slice(0, maxSuggestions)
      .map((name) => ({ insert: `:${name}:`, label: nameToEmoji[name] ?? `:${name}:`, image: githubEmojiURL(name), detail: `:${name}:` }))
    : openToken?.trigger === "/" ? commands(openToken.query) : result?.items ?? [];

  function commands(query: string): Suggestion[] {
    if (commandGroup === "templates") return templateLookup?.items ?? [];
    if (commandGroup === "alerts") return alerts.map((name) => ({
      label: t(`issues.markdown.${name}`), insert: `> [!${name.toUpperCase()}]\n> ${t("issues.composer.commands.alertText")}`,
    }));
    if (commandGroup === "table") return Array.from({ length: 5 }, (_, index) => {
      const count = index + 1;
      const cells = Array.from({ length: count }, (_, col) => t("issues.composer.commands.column", { number: col + 1 }));
      return { label: t("issues.composer.commands.columns", { count }), insert: [cells, cells.map(() => "---"), cells.map(() => " ")]
        .map((row) => `| ${row.join(" | ")} |`).join("\n") };
    });
    const options = {
      alerts: { group: "alerts" },
      code: { insert: "```\n\n```" },
      details: { insert: `<details>\n<summary>${t("issues.composer.commands.summary")}</summary>\n\n${t("issues.composer.commands.detailsText")}\n\n</details>` },
      table: { group: "table" },
      templates: { group: "templates" },
      "saved-replies": { savedReplies: true },
    } as const;
    const search = query.toLowerCase();
    return Object.entries(options).flatMap(([key, option]) => {
      const label = t(`issues.composer.commands.${key}`);
      return key.startsWith(search) || label.toLowerCase().includes(search) ? [{ ...option, label }] : [];
    });
  }
  const index = Math.min(activeIndex, items.length - 1);
  const optionID = (position: number) => `${listID}-${position}`;

  function close() {
    setToken(null);
    setLookup(undefined);
    setActiveIndex(0);
    setCommandGroup(undefined);
  }

  function select(field: HTMLTextAreaElement) {
    if (composing.current) return;
    const next = tokenAtCaret(field);
    const previous = dismissed.current;
    if (previous && next?.start === previous.start && next.end === previous.end
      && next.query === previous.query && next.trigger === previous.trigger
      && next.externalRepository === previous.externalRepository) return;
    dismissed.current = null;
    const lookupChanged = next?.query !== token?.query || next?.trigger !== token?.trigger
      || next?.externalRepository !== token?.externalRepository;
    if (lookupChanged) setLookup(undefined);
    if (lookupChanged || next?.start !== token?.start) {
      setActiveIndex(0);
      setCommandGroup(undefined);
    }
    setToken(next);
  }

  function insertReference(field: HTMLTextAreaElement) {
    const { value, selectionStart, selectionEnd, maxLength } = field;
    const previous = value[selectionStart - 1];
    const next = value[selectionEnd];
    const prefix = previous && !/[\s([{]/u.test(previous) ? " " : "";
    const suffix = next && /[\p{L}\p{N}_+-]/u.test(next) ? " " : "";
    const reference = `${prefix}#${suffix}`;
    if (value.length - (selectionEnd - selectionStart) + reference.length > maxLength) return;
    dismissed.current = null;
    field.focus();
    field.setRangeText(reference, selectionStart, selectionEnd, "end");
    const caret = selectionStart + prefix.length + 1;
    field.setSelectionRange(caret, caret);
    onChange(field.value);
    select(field);
  }

  function complete(field: HTMLTextAreaElement, item: Suggestion) {
    if (!openToken) return;
    if ("group" in item) {
      if (item.group === "templates") setTemplateLookup(undefined);
      setCommandGroup(item.group);
      setActiveIndex(0);
      return;
    }
    const { start, end, trigger } = openToken;
    if ("savedReplies" in item) {
      close();
      onSavedReplies({ start, end });
      return;
    }
    const following = field.value[end];
    const leading = field.value.slice(0, start);
    let insert = following === undefined ? `${item.insert} ` : item.insert;
    if (trigger === "/") {
      const separator = !leading || leading.endsWith("\n\n") ? "" : leading.endsWith("\n") ? "\n" : "\n\n";
      insert = `${separator}${item.insert}\n\n`;
    }
    if (field.value.length - (end - start) + insert.length > field.maxLength) {
      dismissed.current = openToken;
      close();
      return;
    }
    // Native insertion preserves the editor's undo history where supported.
    const before = field.value;
    field.setSelectionRange(start, end);
    if (!field.ownerDocument.execCommand?.("insertText", false, insert) || field.value === before) {
      field.setRangeText(insert, start, end, "end");
    }
    onChange(field.value);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!openToken || composing.current || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (commandGroup) {
        setCommandGroup(undefined);
        setActiveIndex(0);
      } else {
        dismissed.current = openToken;
        close();
      }
    } else if (items.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index + step + items.length) % items.length);
    } else if (index >= 0 && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      complete(event.currentTarget, items[index]);
    }
  }

  let status = "";
  if (openToken && !items.length) {
    if (result?.failed || (showTemplates && templateLookup?.failed)) status = t("issues.composer.suggestionFailed");
    else if ((lookupTrigger && !result) || (showTemplates && !templateLookup)) status = t("common:components.loading");
    else status = t("issues.composer.suggestionEmpty");
  }

  return {
    close,
    select,
    insertReference,
    inputProps: {
      onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => select(event.currentTarget),
      onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!event.nativeEvent.isComposing && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) select(event.currentTarget);
      },
      onCompositionStart: () => {
        composing.current = true;
        close();
      },
      onCompositionEnd: (event: SyntheticEvent<HTMLTextAreaElement>) => {
        composing.current = false;
        select(event.currentTarget);
      },
      onBlur: close,
      onKeyDown,
      "aria-autocomplete": "list" as const,
      "aria-controls": items.length ? listID : undefined,
      "aria-activedescendant": index >= 0 ? optionID(index) : undefined,
    },
    menu: items.length ? <div id={listID} role="listbox" aria-label={openToken?.trigger === "/"
      ? t(commandGroup ? `issues.composer.commands.${commandGroup}` : "issues.composer.commands.menu")
      : t(openToken?.trigger === ":" ? "issues.composer.emojiSuggestions" : openToken?.trigger === "@"
        ? "issues.composer.memberSuggestions" : "issues.composer.referenceSuggestions")} className="issue-composer__completion">
      {items.map((item, position) => <div key={item.id ?? item.label} id={optionID(position)} role="option"
        aria-selected={index === position} onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const field = event.currentTarget.ownerDocument.activeElement;
          if (field instanceof HTMLTextAreaElement) complete(field, item);
        }}>
        <strong>{item.image ? <img src={item.image} alt="" width={18} height={18} /> : item.label}</strong> <span>{item.detail}</span>
      </div>)}
    </div> : (status && <p className="issue-composer__completion-status" role="status">{status}</p>),
  };
}
