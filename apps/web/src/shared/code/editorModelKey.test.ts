import { describe, expect, it } from "vitest";
import { changesetEditorModelKey, workspaceEditorModelKey } from "./editorModelKey";

describe("editor model identities", () => {
  it("scopes changeset models by organization, repository, changeset, and path", () => {
    expect(changesetEditorModelKey("org-1", "owner/repo", "CS-1", "src/main.ts"))
      .toBe("changeset://org-1/owner/repo/CS-1/src/main.ts");
    expect(changesetEditorModelKey("org-1", "owner/repo", "CS-2", "src/main.ts"))
      .not.toBe(changesetEditorModelKey("org-1", "owner/repo", "CS-1", "src/main.ts"));
    expect(changesetEditorModelKey("org-2", "owner/repo", "CS-1", "src/main.ts"))
      .not.toBe(changesetEditorModelKey("org-1", "owner/repo", "CS-1", "src/main.ts"));
  });

  it("scopes workspace models independently", () => {
    expect(workspaceEditorModelKey("workspace-1", "src/main.ts"))
      .toBe("workspace://workspace-1/src/main.ts");
    expect(workspaceEditorModelKey("workspace-2", "src/main.ts"))
      .not.toBe(workspaceEditorModelKey("workspace-1", "src/main.ts"));
  });

  it("encodes URI-significant characters without flattening directory separators", () => {
    expect(workspaceEditorModelKey("workspace #1", "src/a #1?.ts"))
      .toBe("workspace://workspace%20%231/src/a%20%231%3F.ts");
    expect(changesetEditorModelKey("org/one", "owner/repo", "CS #1", "dir/a%name.ts"))
      .toBe("changeset://org%2Fone/owner/repo/CS%20%231/dir/a%25name.ts");
  });
});
