import { describe, expect, it } from "vitest";

import {
  buildFileTreeRows,
  filterCollapsedFileTreeRows,
  folderPathsForFile,
} from "@/lib/files/file-tree";

const files = [
  { path: "src/components/Button.tsx" },
  { path: "src/App.tsx" },
  { path: "package.json" },
];

describe("Editor file tree", () => {
  it("builds stable folder and file rows", () => {
    expect(
      buildFileTreeRows(files).map((row) => [row.kind, row.key, row.depth]),
    ).toEqual([
      ["folder", "folder:src", 0],
      ["folder", "folder:src/components", 1],
      ["file", "file:src/components/Button.tsx", 2],
      ["file", "file:src/App.tsx", 1],
      ["file", "file:package.json", 0],
    ]);
  });

  it("hides descendants while retaining the collapsed folder row", () => {
    const rows = buildFileTreeRows(files);
    expect(
      filterCollapsedFileTreeRows(rows, new Set(["src"])).map((row) => row.key),
    ).toEqual(["folder:src", "file:package.json"]);
    expect(
      filterCollapsedFileTreeRows(rows, new Set(["src/components"])).map(
        (row) => row.key,
      ),
    ).toEqual([
      "folder:src",
      "folder:src/components",
      "file:src/App.tsx",
      "file:package.json",
    ]);
  });

  it("returns all ancestor folders for follow-mode expansion", () => {
    expect(folderPathsForFile("src/components/Button.tsx")).toEqual([
      "src",
      "src/components",
    ]);
    expect(folderPathsForFile("package.json")).toEqual([]);
  });
});
