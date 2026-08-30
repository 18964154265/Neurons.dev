import { extname } from "node:path";

import { z } from "zod";

export const MAX_PROJECT_FILE_BYTES = 256 * 1024;

export const projectFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((path) => !path.startsWith("/"), "文件路径必须是相对路径。")
  .refine((path) => !path.includes("\\"), "文件路径必须使用正斜杠。")
  .refine(
    (path) =>
      !path
        .split("/")
        .some((segment) => !segment || segment === "." || segment === ".."),
    "文件路径包含无效片段。",
  )
  .refine((path) => !path.includes("\0"), "文件路径包含无效字符。");

export const writeProjectFileInputSchema = z
  .object({
    path: projectFilePathSchema,
    content: z
      .string()
      .refine(
        (content) =>
          Buffer.byteLength(content, "utf8") <= MAX_PROJECT_FILE_BYTES,
        `单个文件不得超过 ${MAX_PROJECT_FILE_BYTES} bytes。`,
      ),
  })
  .strict();

export const codingInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    files: z.array(writeProjectFileInputSchema).min(1).max(40),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.files.map((file) => file.path)).size === value.files.length,
    "同一次 coding 调用中不能包含重复路径。",
  );

export const readProjectFileInputSchema = z
  .object({ path: projectFilePathSchema })
  .strict();

export const listProjectFilesInputSchema = z.object({}).strict();

const languageByExtension: Record<string, string> = {
  ".css": "css",
  ".html": "html",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "html",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function languageForProjectFile(path: string) {
  return languageByExtension[extname(path).toLowerCase()] ?? "plaintext";
}

export type ProjectFile = {
  path: string;
  content: string;
  language: string;
  revision: number;
  checksum: string;
  sourceRunId: string | null;
  sourceAgentKey: string | null;
  updatedAt: string;
};
