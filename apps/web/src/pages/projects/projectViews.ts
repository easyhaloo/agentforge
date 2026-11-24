import { projectPriorities, projectStatuses, type ProjectItem, type ProjectView } from "../../shared/api/projects";
import { issueDetailPath, pullRequestPath } from "../../shared/routing";

export function filterProjectItems(items: ProjectItem[], query: string) {
  const terms = query.toLocaleLowerCase().match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
  return items.filter((item) => terms.every((term) => {
    const [field, ...value] = term.split(":");
    const text = value.join(":").replace(/^"|"$/g, "");
    switch (field) {
      case "status": return item.status === text;
      case "priority": return (item.priority ?? "") === text;
      case "type": return item.kind === text;
      case "repo": return item.repository?.toLocaleLowerCase() === text;
      case "iteration": return item.iteration?.toLocaleLowerCase() === text;
      default: return `${item.title} ${item.repository ?? ""} ${item.number ? `#${item.number}` : ""}`.toLocaleLowerCase().includes(term.replace(/^"|"$/g, ""));
    }
  }));
}

export function sortProjectItems(items: ProjectItem[], sort: ProjectView["sort"]) {
  if (sort === "manual") return items;
  return [...items].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "priority") return (a.priority || "z").localeCompare(b.priority || "z");
    return (a.target_date || "9999-12-31").localeCompare(b.target_date || "9999-12-31");
  });
}

export function groupProjectItems(items: ProjectItem[], group: ProjectView["group"]): Array<[string, ProjectItem[]]> {
  if (group === "none") return [["", items]];
  const keys: string[] = [...(group === "status" ? projectStatuses : projectPriorities)];
  if (items.some((item) => !item[group]) || group === "priority") keys.push("");
  return keys.map((key) => [key, items.filter((item) => (item[group] ?? "") === key)]);
}

export function projectItemSource(handle: string, item: ProjectItem) {
  if (!item.repository) return;
  if (item.kind === "issue" && item.number) return issueDetailPath(handle, item.repository, item.number);
  if (item.kind === "pull_request" && item.source_id) return pullRequestPath(handle, item.repository, item.source_id);
}

export function parseProjectSourceLink(input: string, origin: string, organization: string) {
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin) return;
    const segments = url.pathname.split("/").slice(1).map(decodeURIComponent);
    const [orgs, handle, repositories, owner, name, section, reference] = segments;
    if (segments.length !== 7 || orgs !== "orgs" || handle !== organization || repositories !== "repositories" ||
      !owner || !name || [owner, name].some((part) => part.includes("/"))) return;
    const repository = `${owner}/${name}`;
    if (section === "issues" && /^[1-9]\d{0,9}$/.test(reference) && Number(reference) <= 2147483647) {
      return { kind: "issue", repository, number: Number(reference) } as const;
    }
    if (section === "pulls" && /^[A-Za-z0-9_-]{1,128}$/.test(reference)) {
      return { kind: "pull_request", repository, source_id: reference } as const;
    }
  } catch { /* A malformed URL is not a valid project source. */ }
}

export function projectCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => {
    const text = /^\s*[=+@-]|^[\t\r\n]/.test(cell) ? `'${cell}` : cell;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}
