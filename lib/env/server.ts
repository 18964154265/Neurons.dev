import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgres"),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_DEFAULT_MODEL: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  APP_URL: z.url().default("http://localhost:3000"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  cachedEnvironment = serverEnvironmentSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL ?? process.env.POSTGRESQL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    OPENROUTER_DEFAULT_MODEL:
      process.env.OPENROUTER_DEFAULT_MODEL ?? process.env.OPENROUTER_MODEL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    APP_URL: process.env.APP_URL,
  });

  return cachedEnvironment;
}
