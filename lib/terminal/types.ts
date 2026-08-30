import { z } from "zod";

const terminalCwdSchema = z
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

export const terminalRunInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    command: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._+-]+$/, "command 必须是单个 executable。"),
    args: z.array(z.string().max(4_000)).max(40).default([]),
    cwd: terminalCwdSchema.default("."),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(60_000),
  })
  .strict();

export type TerminalRunInput = z.infer<typeof terminalRunInputSchema>;

export type TerminalChunk = {
  id: string;
  sequence: number;
  stream: "stdout" | "stderr";
  content: string;
  byteLength: number;
  createdAt: string;
};

export type TerminalSession = {
  id: string;
  runId: string | null;
  agentKey: string | null;
  commandSummary: string;
  cwd: string;
  status: "started" | "progress" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  chunks: TerminalChunk[];
};
