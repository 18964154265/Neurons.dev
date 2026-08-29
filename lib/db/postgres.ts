import "server-only";

import postgres from "postgres";

let database: ReturnType<typeof postgres> | undefined;

export function getDatabase() {
  if (database) return database;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL_MISSING");
  }
  database = postgres(connectionString, {
    max: 2,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return database;
}
