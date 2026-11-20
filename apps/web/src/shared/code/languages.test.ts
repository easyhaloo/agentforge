import { describe, expect, it } from "vitest";
import { codeLanguageLabel, detectCodeLanguage, listCodeLanguages } from "./languages";

describe("shared code language registry", () => {
  it("detects by extension regardless of directory", () => {
    expect(detectCodeLanguage("src/deep/main.ts")?.id).toBe("typescript");
    expect(detectCodeLanguage("config/ci.yml")?.id).toBe("yaml");
  });

  it("detects special basenames and dotfiles", () => {
    expect(detectCodeLanguage("Dockerfile")?.id).toBe("dockerfile");
    expect(detectCodeLanguage("Containerfile")?.id).toBe("dockerfile");
    expect(detectCodeLanguage(".bashrc")?.id).toBe("shell");
    expect(detectCodeLanguage("Makefile")?.id).toBe("makefile");
  });

  it("uses a shebang when the path has no recognized extension", () => {
    expect(detectCodeLanguage("scripts/bootstrap", "#!/usr/bin/env python3")?.id).toBe("python");
    expect(detectCodeLanguage("bin/start", "#!/bin/bash")?.id).toBe("shell");
    expect(detectCodeLanguage("scripts/unknown", "#!/usr/bin/env ruby")).toBeUndefined();
  });

  it("provides both Shiki and Monaco identifiers and a readable fallback", () => {
    const languages = listCodeLanguages();
    expect(languages.length).toBeGreaterThan(15);
    expect(languages.every(language => language.shiki && language.monaco)).toBe(true);
    expect(codeLanguageLabel("assets/opaque.data")).toBe("opaque.data");
    expect(codeLanguageLabel("src/main.ts")).toBe("TypeScript");
  });
});
