import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectPageComponents(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      if (relative(sourceRoot, path).split(sep)[0] === "shared") return [];
      return collectPageComponents(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("shared UI adoption", () => {
  it("keeps native interactive controls inside the shared UI implementation", () => {
    const violations: string[] = [];
    for (const file of collectPageComponents(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      if (/window\.(confirm|alert|prompt)\s*\(/.test(source)) {
        violations.push(`${relative(sourceRoot, file)} uses a native browser dialog instead of shared UI`);
      }
      if (/role=["']dialog["']|modal-backdrop/.test(source)) {
        violations.push(`${relative(sourceRoot, file)} implements a dialog outside shared UI`);
      }
      for (const match of source.matchAll(/<(button|input|select|textarea)\b/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${relative(sourceRoot, file)}:${line} uses native <${match[1]}> instead of shared UI`);
      }
    }
    expect(violations).toEqual([]);
  });
});
