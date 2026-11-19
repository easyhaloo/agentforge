import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../locales";
import { WebIDEPage } from "./WebIDEPage";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

describe("WebIDEPage", () => {
  it("renders a read-only repository workspace shell", () => {
    const html = renderToStaticMarkup(<WebIDEPage organization={{ id: "org-1", slug: "demo", name: "Demo", role: "owner" }}/>);
    expect(html).toContain("WebIDE");
    expect(html).toContain("READ ONLY");
    expect(html).toContain("Select a file to preview");
    expect(html).toContain("Editing and write-back are not enabled");
  });
});
