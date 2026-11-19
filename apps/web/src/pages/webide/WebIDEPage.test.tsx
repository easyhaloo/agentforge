import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lineStartOffset, WebIDEPage } from "./WebIDEPage";

describe("WebIDEPage", () => {
  it("renders a changeset-aware editor shell without enabling writes before a changeset is selected", () => {
    const html = renderToStaticMarkup(<WebIDEPage organization={{ id: "org-1", slug: "demo", name: "Demo", role: "owner" }}/>);
    expect(html).toContain("WebIDE");
    expect(html).toContain("READ ONLY");
    expect(html).toContain("Select a file to edit");
    expect(html).toContain("Choose a Changeset to enable safe text editing");
  });
});
