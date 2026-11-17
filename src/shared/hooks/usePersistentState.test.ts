import { describe, expect, it } from "vitest";
import { readPersistentValue } from "./usePersistentState";

describe("readPersistentValue", () => {
  const createStorage = (entries: Record<string, string>) => ({
    getItem: (key: string) => entries[key] ?? null,
  });

  it("reads the value associated with the requested key", () => {
    const storage = createStorage({
      "agentforge:resources:Changesets": JSON.stringify([{ id: "CS-1" }]),
      "agentforge:resources:Eval": JSON.stringify([{ id: "EVL-1" }]),
    });

    expect(readPersistentValue("agentforge:resources:Eval", [], storage)).toEqual([{ id: "EVL-1" }]);
  });

  it("returns the initial value when the key is missing", () => {
    expect(readPersistentValue("missing", ["default"], createStorage({}))).toEqual(["default"]);
  });

  it("returns the initial value when stored JSON is malformed", () => {
    expect(readPersistentValue("broken", { enabled: true }, createStorage({ broken: "{" }))).toEqual({ enabled: true });
  });
});
