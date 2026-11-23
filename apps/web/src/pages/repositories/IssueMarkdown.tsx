import type { Element, ElementContent, Root, Text } from "hast";
import type { Image, Root as MarkdownRoot, Text as MarkdownText } from "mdast";
import { useEffect, useId, useMemo, useRef, type ComponentPropsWithoutRef } from "react";
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownHooks, type Components, type HooksOptions } from "react-markdown";
import { Link } from "react-router-dom";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import { SKIP, visit } from "unist-util-visit";
import { issuesAPI } from "../../shared/api/issues";
import { repositoryPreviewAPI } from "../../shared/api/identity";
import { issueDetailPath, repositoryPath } from "../../shared/routing";
import { githubEmojiURL } from "./githubEmoji";

const videoAttachment = /^\/api\/v1\/organizations\/[^/?#]+\/issue-attachments\/[a-f0-9]{32}\?media=video$/;
const alerts = {
  NOTE: { icon: Info, label: "issues.markdown.note" },
  TIP: { icon: Lightbulb, label: "issues.markdown.tip" },
  IMPORTANT: { icon: CircleAlert, label: "issues.markdown.important" },
  WARNING: { icon: TriangleAlert, label: "issues.markdown.warning" },
  CAUTION: { icon: OctagonAlert, label: "issues.markdown.caution" },
} as const;

function isAlert(value: unknown): value is keyof typeof alerts {
  return typeof value === "string" && Object.hasOwn(alerts, value);
}

function issueAlerts() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "blockquote") return;
      const paragraph = node.children.find((child) => child.type === "element");
      if (paragraph?.type !== "element" || paragraph.tagName !== "p") return;
      const [marker, separator] = paragraph.children;
      const kind = marker?.type === "text" ? /^\[!([a-z]+)\][ \t]*$/i.exec(marker.value)?.[1].toUpperCase() : undefined;
      if (!isAlert(kind) || (separator && (separator.type !== "element" || separator.tagName !== "br"))) return;
      if (paragraph.children.length <= 2 && node.children.filter((child) => child.type === "element").length < 2) return;
      node.properties.dataIssueAlert = kind;
      paragraph.children.splice(0, separator ? 2 : 1);
      if (!paragraph.children.length) node.children.splice(node.children.indexOf(paragraph), 1);
    });
  };
}

function GitHubReferenceLink({ reference, title, state, children, ...props }: ComponentPropsWithoutRef<"a"> & {
  reference: string; title: string; state: "open" | "closed" | "merged";
}) {
  const { t } = useTranslation("repositories");
  const id = useId();
  const card = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number>(undefined);
  function show(link: HTMLAnchorElement) {
    const popup = card.current;
    if (!popup || popup.matches(":popover-open")) return;
    const rect = link.getBoundingClientRect();
    document.querySelector<HTMLElement>(openReferenceCard)?.hidePopover();
    popup.showPopover();
    popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${rect.bottom + popup.offsetHeight <= window.innerHeight - 8
      ? rect.bottom : Math.max(8, rect.top - popup.offsetHeight)}px`;
  }
  return <span
    onPointerEnter={() => window.clearTimeout(closeTimer.current)}
    onPointerLeave={(event) => {
      if (event.currentTarget.contains(document.activeElement)) return;
      closeTimer.current = window.setTimeout(() => card.current?.hidePopover(), 150);
    }}
  >
    <a {...props} aria-describedby={id}
      onPointerMove={(event) => { if (event.pointerType !== "touch") show(event.currentTarget); }}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => card.current?.hidePopover()}
    >{children}</a>
    <span ref={card} id={id} className="issue-markdown__reference-card" role="tooltip" popover="manual">
      <span>{reference} · {t(`issues.markdown.referenceState.${state}`)}</span>
      <strong>{title}</strong>
    </span>
  </span>;
}

const openReferenceCard = ".issue-markdown__reference-card:popover-open";

const components: Components = {
  a: ({ node, href, children, ...props }) => {
    if (href?.startsWith("#") && (node?.properties.dataFootnoteRef !== undefined || node?.properties.dataFootnoteBackref !== undefined)) {
      // Sanitization prefixes the target ID to prevent DOM clobbering.
      href = `#${defaultSchema.clobberPrefix}${href.slice(1)}`;
    }
    if (href && node?.properties.dataIssueReference === true) return <Link to={href} title={props.title}>{children}</Link>;
    const { dataGithubReference, dataGithubTitle, dataGithubState } = node?.properties ?? {};
    if (href && typeof dataGithubReference === "string" && typeof dataGithubTitle === "string"
      && (dataGithubState === "open" || dataGithubState === "closed" || dataGithubState === "merged")) {
      return <GitHubReferenceLink {...props} href={href} reference={dataGithubReference} title={dataGithubTitle} state={dataGithubState}>{children}</GitHubReferenceLink>;
    }
    if (!href || !videoAttachment.test(href)) return <a {...props} href={href}>{children}</a>;
    return <span className="issue-markdown__video">
      <video src={href} controls preload="metadata" playsInline aria-label={typeof children === "string" ? children : undefined} />
      <a href={`${href}&download=1`} download>{children}</a>
    </span>;
  },
  blockquote: function IssueBlockquote({ node, children }) {
    const { t } = useTranslation("repositories");
    const kind = node?.properties.dataIssueAlert;
    if (!isAlert(kind)) return <blockquote>{children}</blockquote>;
    const { icon: Icon, label } = alerts[kind];
    return <div className="issue-markdown__alert" data-kind={kind}>
      <p className="issue-markdown__alert-title"><Icon size={16} aria-hidden="true" />{t(label)}</p>
      {children}
    </div>;
  },
};

const issueURLPath = /^\/orgs\/([^/]+)\/repositories\/([a-z0-9_-]+\/[a-z0-9_.-]+)\/issues\/([1-9]\d*)$/i;
const githubCommitURL = /^https:\/\/github\.com\/([a-z0-9_-]+\/[a-z0-9_.-]+)\/commit\/([0-9a-f]{7,40})([?#].*)?$/i;
const githubRepository = /^[a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100}$/i;
const githubIssuePath = /^\/([a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100})\/(?:issues|pull)\/([1-9]\d*)$/i;
const githubIssueComment = /^#(?:issuecomment-|discussion_r|pullrequestreview-)\d+$/;
const reference = /(?<![\p{L}\p{N}_./@-])(?:(?:(?<repository>[a-z0-9_-]+\/[a-z0-9_.-]+)?#|GH-)(?<number>\d+)(?![\p{L}\p{N}_])|(?:(?<commitOwner>[a-z0-9_-]+)(?:\/(?<commitRepo>[a-z0-9_.-]+))?@)?(?<sha>[0-9a-f]{7,40})(?![\p{L}\p{N}_/@-]|\.[\p{L}\p{N}_]))/giu;
function remarkGitHubEmoji() {
  return (tree: MarkdownRoot) => {
    visit(tree, "text", (node, index, parent) => {
      if (index === undefined || !parent) return;
      const children: (MarkdownText | Image)[] = [];
      let offset = 0;
      for (const match of node.value.matchAll(/:([a-z0-9]+):/g)) {
        const url = githubEmojiURL(match[1]);
        if (!url || match.index === undefined) continue;
        if (offset < match.index) children.push({ type: "text", value: node.value.slice(offset, match.index) });
        children.push({ type: "image", url, alt: match[0], data: { hProperties: { width: 18, height: 18 } } });
        offset = match.index + match[0].length;
      }
      if (!offset) return;
      if (offset < node.value.length) children.push({ type: "text", value: node.value.slice(offset) });
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}

const remarkPlugins = [remarkGfm, remarkBreaks, remarkGemoji, remarkGitHubEmoji];
const remarkRehypeOptions = { clobberPrefix: "" };

function commitReference(match: RegExpMatchArray, repository: string) {
  const sha = match.groups?.sha?.toLowerCase();
  if (!sha) return;
  const owner = match.groups?.commitOwner;
  const target = owner ? `${owner}/${match.groups?.commitRepo ?? repository.split("/")[1]}` : repository;
  return { sha, target, key: `${target}@${sha}` };
}

function githubCard(target: string, number: number, result: { title?: string; state?: string }) {
  return result.title ? {
    dataGithubReference: `${target}#${number}`,
    dataGithubTitle: result.title,
    dataGithubState: result.state,
  } : {};
}

function markdownReferences(organizationID: string, handle: string, repository: string, commentLabel: (reference: string) => string) {
  return async (tree: Root) => {
    const requested = new Map<string, { org: string; target: string; numbers: Set<number> }>();
    const commits = new Map<string, { target: string; sha: string }>();
    const issueLinks: { node: Element; org: string; target: string; number: number; href: string; bare: boolean }[] = [];
    const githubIssues = new Map<string, { target: string; number: number; links: { node: Element; hash: string; bare: boolean }[] }>();
    const githubLookups = new Map<string, ReturnType<typeof lookupGitHub>>();
    const issueKey = (org: string, target: string) => `${org}/${target}`;
    const githubKey = (target: string, number: number) => `${target.toLowerCase()}#${number}`;
    function lookupGitHub(target: string, number: number) {
      return issuesAPI.githubReference(organizationID, target, number).catch(() => undefined);
    }
    function requestGitHub(target: string, number: number) {
      const key = githubKey(target, number);
      if (!githubLookups.has(key) && githubLookups.size < 8) githubLookups.set(key, lookupGitHub(target, number));
      return githubLookups.get(key);
    }
    let uniqueCount = 0;
    function requestIssue(org: string, target: string, number: number) {
      if (number < 1 || number > 2147483647) return false;
      const key = issueKey(org, target);
      let numbers = requested.get(key)?.numbers;
      if (numbers?.has(number)) return true;
      // Bound lookup fan-out and total numbers for pasted issue lists.
      if (uniqueCount >= 100 || (!numbers && requested.size >= 8)) return false;
      if (!numbers) requested.set(key, { org, target, numbers: numbers = new Set() });
      numbers.add(number);
      uniqueCount += 1;
      return true;
    }
    const texts: { parent: Root | Extract<ElementContent, { type: "element" }>; index: number; text: Text; matches: RegExpMatchArray[] }[] = [];
    visit(tree, (node, index, parent) => {
      if (node.type === "element" && node.tagName === "a") {
        const { href } = node.properties;
        const [label] = node.children;
        if (typeof href !== "string") return SKIP;
        const bare = node.children.length === 1 && label?.type === "text" && label.value === href;
        const url = URL.parse(href, window.location.href);
        const issue = url?.origin === window.location.origin && !url.username && !url.password
          ? issueURLPath.exec(url.pathname)
          : null;
        if (url && issue && /^[a-z0-9_-]+$/i.test(issue[1])) {
          const [, handleInURL, target, id] = issue;
          const org = handleInURL === handle ? organizationID : handleInURL;
          const number = Number(id);
          if (requestIssue(org, target, number)) {
            issueLinks.push({ node, org, target, number, href: `${url.pathname}${url.search}${url.hash}`, bare });
          }
        }
        const githubIssue = url?.origin === "https://github.com" && !url.username && !url.password
          ? githubIssuePath.exec(url.pathname)
          : null;
        if (url && githubIssue) {
          const [, target, id] = githubIssue;
          const number = Number(id);
          const key = githubKey(target, number);
          const link = { node, hash: url.hash, bare };
          const requested = githubIssues.get(key);
          if (requested) requested.links.push(link);
          else if (number <= 2147483647 && githubIssues.size < 8) {
            githubIssues.set(key, { target, number, links: [link] });
          }
        }
        if (bare) {
          // ponytail: compact same-repository GitHub URLs without a lookup against external repositories.
          const link = githubCommitURL.exec(href);
          if (link && link[1].toLowerCase() === repository.toLowerCase()) {
            node.children = [{ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: link[2].slice(0, 7) }] }];
            if (link[3]) node.children.push({ type: "text", value: link[3] });
          }
        }
        return SKIP;
      }
      if (node.type === "element" && ["code", "pre", "kbd", "samp"].includes(node.tagName)) return SKIP;
      if (node.type !== "text" || index === undefined || !parent) return;
      const matches = Array.from(node.value.matchAll(reference)).filter((match) => {
        const commit = commitReference(match, repository);
        if (commit) {
          if (!commits.has(commit.key) && commits.size >= 8) return false;
          commits.set(commit.key, commit);
          return true;
        }
        const target = match.groups?.repository ?? repository;
        return requestIssue(organizationID, target, Number(match.groups?.number));
      });
      if (matches.length) texts.push({ parent, index, text: node, matches });
    });
    if (!texts.length && !issueLinks.length && !githubIssues.size) return;
    const [issueResults, commitResults] = await Promise.all([
      Promise.all([...requested].map(async ([key, { org, target, numbers }]) => {
        const found = await issuesAPI.references(org, target, [...numbers]).catch(() => undefined);
        return [key, found && new Set(found)] as const;
      })),
      Promise.all([...commits].map(async ([key, { target, sha }]) => {
        const history = await repositoryPreviewAPI.history(organizationID, target, sha, 1, AbortSignal.timeout(3000)).catch(() => undefined);
        const fullSHA = history?.commit_sha;
        const found = fullSHA?.startsWith(sha) && history?.items[0]?.sha === fullSHA ? fullSHA : undefined;
        return [key, found] as const;
      })),
      Promise.all([...githubIssues.values()].map(async ({ target, number, links }) => {
        const result = await requestGitHub(target, number);
        if (result?.kind !== "issues" && result?.kind !== "pull") return;
        const label = `${target.toLowerCase() === repository.toLowerCase() ? "" : target}#${number}`;
        for (const { node, hash, bare } of links) {
          Object.assign(node.properties, githubCard(target, number, result));
          if (!bare) continue;
          const isComment = githubIssueComment.test(hash);
          node.properties.href = `https://github.com/${target}/${result.kind}/${number}${isComment ? hash : ""}`;
          node.children = [{ type: "text", value: isComment ? commentLabel(label) : label }];
        }
      })),
    ]);
    const existing = new Map(issueResults);
    const resolvedCommits = new Map(commitResults);
    for (const { node, org, target, number, href, bare } of issueLinks) {
      if (!existing.get(issueKey(org, target))?.has(number)) continue;
      node.properties.href = href;
      node.properties.dataIssueReference = true;
      if (bare) node.children = [{ type: "text", value: `${org === organizationID && target === repository ? "" : target}#${number}` }];
    }
    const shorthand = new Map<string, NonNullable<Awaited<ReturnType<typeof lookupGitHub>>>>();
    const qualified = new Map<string, { target: string; number: number }>();
    for (const { matches } of texts) {
      for (const match of matches) {
        const target = match.groups?.repository;
        if (!target || target.toLowerCase() === repository.toLowerCase() || !githubRepository.test(target)) continue;
        const number = Number(match.groups?.number);
        const found = existing.get(issueKey(organizationID, target));
        if (found && !found.has(number)) qualified.set(githubKey(target, number), { target, number });
      }
    }
    await Promise.all([...qualified].map(async ([key, { target, number }]) => {
      const result = await requestGitHub(target, number);
      if (result?.kind === "issues" || result?.kind === "pull") shorthand.set(key, result);
    }));
    for (const { parent, index, text, matches } of texts.reverse()) {
      const children: ElementContent[] = [];
      let offset = 0;
      for (const match of matches) {
        if (match.index === undefined) continue;
        const commit = commitReference(match, repository);
        let link: Extract<ElementContent, { type: "element" }>;
        if (commit) {
          const sha = resolvedCommits.get(commit.key);
          if (!sha) continue;
          const label: ElementContent[] = [{ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: sha.slice(0, 7) }] }];
          if (commit.target !== repository) label.unshift({ type: "text", value: match[0].split("@")[0] + "@" });
          link = {
            type: "element", tagName: "a",
            properties: { href: `${repositoryPath(handle, commit.target)}?change=${sha}`, title: sha, dataIssueReference: true },
            children: label,
          };
        } else {
          const target = match.groups?.repository ?? repository;
          const number = Number(match.groups?.number);
          const local = existing.get(issueKey(organizationID, target))?.has(number);
          const github = !local && match.groups?.repository && shorthand.get(githubKey(target, number));
          if (!local && !github) continue;
          link = {
            type: "element", tagName: "a",
            properties: github ? {
              href: `https://github.com/${target}/${github.kind}/${number}`,
              ...githubCard(target, number, github),
            } : { href: issueDetailPath(handle, target, number), dataIssueReference: true },
            children: [{ type: "text", value: match[0] }],
          };
        }
        if (offset < match.index) children.push({ type: "text", value: text.value.slice(offset, match.index) });
        children.push(link);
        offset = match.index + match[0].length;
      }
      if (!offset) continue;
      if (offset < text.value.length) children.push({ type: "text", value: text.value.slice(offset) });
      parent.children.splice(index, 1, ...children);
    }
  };
}

type IssueMarkdownProps = { content: string; organizationID: string; handle: string; repository: string };

export function IssueMarkdown({ content, organizationID, handle, repository }: IssueMarkdownProps) {
  const { t } = useTranslation("repositories");
  const markdown = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function dismissReferenceCard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      markdown.current?.querySelector<HTMLElement>(openReferenceCard)?.hidePopover();
    }
    document.addEventListener("keydown", dismissReferenceCard);
    return () => document.removeEventListener("keydown", dismissReferenceCard);
  }, []);
  const rehypePlugins = useMemo<HooksOptions["rehypePlugins"]>(() => [
    [rehypeRaw, { tagfilter: true }], rehypeSanitize, issueAlerts,
    () => markdownReferences(organizationID, handle, repository, (reference) => t("issues.markdown.referenceComment", { reference })),
  ], [organizationID, handle, repository, t]);
  return <div ref={markdown} className="repository-readme issue-markdown">
    <MarkdownHooks
      key={`${organizationID}/${handle}/${repository}:${content}`}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      remarkRehypeOptions={remarkRehypeOptions}
      components={components}
    >{content}</MarkdownHooks>
  </div>;
}
