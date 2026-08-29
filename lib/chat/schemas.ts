import { z } from "zod";

import { agentModeSchema, scheduleStrategySchema } from "@/lib/projects/schemas";

export const sendMessageSchema = z
  .object({
    message: z.string().min(1).max(32_768),
    mode: agentModeSchema,
    scheduleStrategy: scheduleStrategySchema,
    agentKeys: z.array(z.string().min(1).max(80)).max(32).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scheduleStrategy === "user_selected" && value.agentKeys.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["agentKeys"],
        message: "用户指定调度必须选择至少一个 Agent。",
      });
    }
  });
