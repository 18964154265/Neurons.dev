import { describe, expect, it } from "vitest";

import {
  codingInputSchema,
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

  it("accepts a multi-file coding payload and rejects duplicate paths", () => {
    expect(
      codingInputSchema.parse({
        summary: "创建页面",
        files: [
          {
            path: "app/page.tsx",
            content: "export default function Page() {}",
          },
          { path: "app/page.css", content: "body {}" },
        ],
      }).files,
    ).toHaveLength(2);
    expect(() =>
      codingInputSchema.parse({
        summary: "重复文件",
        files: [
          { path: "app/page.tsx", content: "one" },
          { path: "app/page.tsx", content: "two" },
        ],
      }),
    ).toThrow();
  });
});
