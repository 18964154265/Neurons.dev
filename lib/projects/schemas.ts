import { z } from "zod";

export const agentModeSchema = z.enum(["engineer", "team"]);
export const scheduleStrategySchema = z.enum(["automatic", "user_selected"]);

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    initialMessage: z.string().min(1).max(32_768),
    mode: agentModeSchema.default("engineer"),
    scheduleStrategy: scheduleStrategySchema.default("automatic"),
    agentKeys: z.array(z.string().min(1).max(80)).max(32).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.scheduleStrategy === "user_selected" &&
      value.agentKeys.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["agentKeys"],
        message: "用户指定调度必须选择至少一个 Agent。",
      });
    }
  });

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    defaultMode: agentModeSchema.optional(),
    defaultScheduleStrategy: scheduleStrategySchema.optional(),
    revision: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.defaultMode !== undefined ||
      value.defaultScheduleStrategy !== undefined,
    { message: "至少需要修改一个字段。" },
  );

export const archiveProjectSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();

export const projectIdSchema = z.string().uuid();

export function defaultProjectName(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 40) || "Untitled project";
}
