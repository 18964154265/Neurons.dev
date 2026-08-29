import { createHash } from "node:crypto";

import type { z } from "zod";

import type { ProjectRepository } from "./repository";
import { createProjectSchema, defaultProjectName, updateProjectSchema } from "./schemas";

type CreateProjectInput = z.infer<typeof createProjectSchema>;
type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

function stableRequestHash(input: CreateProjectInput) {
  const normalized = JSON.stringify({
    agentKeys: [...input.agentKeys].sort(),
    initialMessage: input.initialMessage,
    mode: input.mode,
    name: input.name ?? null,
    scheduleStrategy: input.scheduleStrategy,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  create(input: CreateProjectInput, idempotencyKey: string) {
    return this.repository.create({
      ...input,
      name: input.name ?? defaultProjectName(input.initialMessage),
      clientRequestId: idempotencyKey,
      requestHash: stableRequestHash(input),
    });
  }

  list(limit = 30) {
    return this.repository.list(Math.min(Math.max(limit, 1), 50));
  }

  get(projectId: string) {
    return this.repository.get(projectId);
  }

  update(projectId: string, input: UpdateProjectInput) {
    return this.repository.update(projectId, input.revision, input);
  }
}
