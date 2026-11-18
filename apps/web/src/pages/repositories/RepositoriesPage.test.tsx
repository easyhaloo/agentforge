import { describe, expect, it } from "vitest";
import { formatRepositoryFileSize } from "./repositoryFileUtils";

describe("formatRepositoryFileSize", () => {
  it("formats byte, kilobyte, and megabyte sizes", () => {
    expect(formatRepositoryFileSize(512)).toBe("512 B");
    expect(formatRepositoryFileSize(1536)).toBe("1.5 KB");
    expect(formatRepositoryFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("handles missing and invalid sizes", () => {
    expect(formatRepositoryFileSize()).toBe("Size unavailable");
    expect(formatRepositoryFileSize(-1)).toBe("Size unavailable");
  });
});
