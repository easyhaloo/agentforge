export type RepositoryMarkdownTarget =
  | { kind: "external"; href: string }
  | { kind: "internal"; path: string; fragment?: string }
  | { kind: "anchor"; href: string }
  | { kind: "unsafe" };

export function resolveRepositoryMarkdownTarget(target: string, sourcePath: string): RepositoryMarkdownTarget {
  const value = target.trim();
  if (!value || value.startsWith("//") || value.startsWith("\\") || /[\u0000-\u001f\u007f]/.test(value)) return { kind: "unsafe" };
  if (value.startsWith("#")) return { kind: "anchor", href: value };
  try {
    const absolute = new URL(value);
    return ["https:", "http:", "mailto:"].includes(absolute.protocol) ? { kind: "external", href: absolute.href } : { kind: "unsafe" };
  } catch { /* relative path */ }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || value.includes("\\")) return { kind: "unsafe" };
  const hashAt = value.indexOf("#");
  const queryAt = value.indexOf("?");
  const cut = [hashAt, queryAt].filter(index => index >= 0).reduce((a, b) => Math.min(a, b), value.length);
  const rawPath = value.slice(0, cut);
  const fragment = hashAt >= 0 ? value.slice(hashAt) : undefined;
  if (!rawPath) return fragment ? { kind: "anchor", href: fragment } : { kind: "unsafe" };
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return { kind: "unsafe" }; }
  if (decoded.includes("\\") || decoded.startsWith("/") || decoded.includes("\u0000")) return { kind: "unsafe" };
  const segments = sourcePath.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { if (!segments.length) return { kind: "unsafe" }; segments.pop(); }
    else segments.push(segment);
  }
  return segments.length ? { kind: "internal", path: segments.join("/"), ...(fragment ? { fragment } : {}) } : { kind: "unsafe" };
}
