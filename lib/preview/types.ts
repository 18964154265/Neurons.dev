import { z } from "zod";

const previewCwdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith("/"), "cwd 必须是项目相对路径。")
  .refine((value) => !value.includes("\\"), "cwd 必须使用正斜杠。")
  .refine(
    (value) =>
      value === "." ||
      !value
        .split("/")
        .some((segment) => !segment || segment === "." || segment === ".."),
    "cwd 包含无效路径片段。",
  );

export const previewStartInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    script: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9:._-]+$/, "script 必须是 package.json 中的脚本名。"),
    args: z.array(z.string().max(4_000)).max(20).default([]),
    cwd: previewCwdSchema.default("."),
    port: z.number().int().min(1024).max(65535).default(3000),
    startupTimeoutMs: z.number().int().min(2_000).max(60_000).default(30_000),
  })
  .strict();

export type PreviewStartInput = z.infer<typeof previewStartInputSchema>;

export type ProjectPreview = {
  kind: "sandbox";
  status: "starting" | "ready" | "failed";
  url: string | null;
  port: number;
  expiresAt: string | null;
  updatedAt: string;
};
