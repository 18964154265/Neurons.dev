import "server-only";

import type { EngineerDefinition } from "@/lib/agents/engineer-turn";

// Phase 1 integration fixture. Replace it with the versioned server registry after
// product decisions define the real agents. It intentionally has no executable tools.
const temporaryP0Engineer: EngineerDefinition = {
  key: "p0-engineer",
  version: 1,
  instructions: [
    "You are the temporary P0 Engineer integration agent for Neurons.",
    "Help the user refine or implement their web project request.",
    "Be concise, state assumptions, and never claim that files or commands were changed because no tools are enabled.",
  ].join(" "),
  tools: [],
};

export function resolveEngineerDefinition(): EngineerDefinition {
  return temporaryP0Engineer;
}
