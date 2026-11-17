import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function resolveLayer(sourceFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(sourceFile), specifier);
  const path = relative(sourceRoot, target);
  if (path.startsWith("..")) return null;
  return path.split(sep)[0] ?? null;
}

function findBoundaryViolations(): string[] {
  const violations: string[] = [];

  for (const sourceFile of collectSourceFiles(sourceRoot)) {
    const sourcePath = relative(sourceRoot, sourceFile);
    const [sourceLayer, sourceModule] = sourcePath.split(sep);
    const source = readFileSync(sourceFile, "utf8");
    const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)];

    for (const match of imports) {
      const specifier = match[1];
      const targetLayer = resolveLayer(sourceFile, specifier);
      if (!targetLayer) continue;

      const targetPath = relative(sourceRoot, resolve(dirname(sourceFile), specifier));
      const targetModule = targetPath.split(sep)[1];

      if (sourceLayer === "entities" && ["app", "pages", "features", "domain", "shared"].includes(targetLayer)) {
        violations.push(`${sourcePath} -> ${specifier}: entities must remain foundational`);
      }

      if (sourceLayer === "domain" && ["app", "pages", "features", "shared"].includes(targetLayer)) {
        violations.push(`${sourcePath} -> ${specifier}: domain may depend only on entities`);
      }

      if (sourceLayer === "shared" && ["app", "pages", "features", "entities", "domain"].includes(targetLayer)) {
        violations.push(`${sourcePath} -> ${specifier}: shared must not depend on business layers`);
      }

      if (sourceLayer === "features" && ["app", "pages"].includes(targetLayer)) {
        violations.push(`${sourcePath} -> ${specifier}: features must not depend on app or pages`);
      }

      if (sourceLayer === "features" && targetLayer === "features" && sourceModule !== targetModule) {
        violations.push(`${sourcePath} -> ${specifier}: feature-to-feature imports are not allowed`);
      }

      if (sourceLayer === "pages" && targetLayer === "app") {
        violations.push(`${sourcePath} -> ${specifier}: pages must not depend on app`);
      }
    }
  }

  return violations;
}

describe("module dependency boundaries", () => {
  it("keeps imports aligned with the documented architecture", () => {
    expect(findBoundaryViolations()).toEqual([]);
  });
});
