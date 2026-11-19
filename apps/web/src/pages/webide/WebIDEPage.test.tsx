import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebIDEPage } from "./WebIDEPage";

describe("WebIDEPage", () => {
  it("renders a read-only repository workspace shell", () => {
    const html = renderToStaticMarkup(<WebIDEPage organization={{ id: "org-1", slug: "demo", name: "Demo", role: "owner" }}/>);
    expect(html).toContain("WebIDE");
    expect(html).toContain("READ ONLY");
    expect(html).toContain("Select a file to preview");
    expect(html).toContain("Editing and write-back are not enabled");
  });
});
