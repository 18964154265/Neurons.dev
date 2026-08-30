import { describe, expect, it } from "vitest";

import {
  languageForProjectFile,
  projectFilePathSchema,
  writeProjectFileInputSchema,
} from "@/lib/files/project-file";

describe("project file boundary", () => {
  it.each(["src/app.tsx", "README.md", "public/index.html"])(
    "accepts safe relative path %s",
    (path) => expect(projectFilePathSchema.parse(path)).toBe(path),
  );

  it.each(["/etc/passwd", "../secret", "src//app.ts", "src\\app.ts"])(
    "rejects unsafe path %s",
    (path) => expect(() => projectFilePathSchema.parse(path)).toThrow(),
  );

  it("enforces the file byte limit and derives Monaco languages", () => {
    expect(() =>
      writeProjectFileInputSchema.parse({
        path: "large.txt",
        content: "x".repeat(256 * 1024 + 1),
      }),
    ).toThrow();
    expect(languageForProjectFile("app/page.tsx")).toBe("typescript");
    expect(languageForProjectFile("Dockerfile")).toBe("plaintext");
  });
});
