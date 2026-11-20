import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../locales";
import { lineStartOffset, WebIDEPage } from "./WebIDEPage";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

describe("WebIDEPage", () => {
  it("waits for repository discovery before offering file selection", () => {
    const html = renderToStaticMarkup(<WebIDEPage organization={{ id: "org-1", slug: "demo", name: "Demo", role: "owner" }}/>);
    expect(html).toContain("Loading repository content");
    expect(html).not.toContain("Select a file to edit");
    expect(html).not.toContain("No repositories registered");
  });

  it("calculates one-based deep-link offsets using actual newline boundaries", () => {
    const content = "alpha\nbeta\ngamma";
    expect(lineStartOffset(content, 1)).toBe(0);
    expect(lineStartOffset(content, 2)).toBe(6);
    expect(lineStartOffset(content, 3)).toBe(11);
    expect(lineStartOffset(content, 99)).toBe(11);
    expect(lineStartOffset(content, 0)).toBe(0);
  });
});
