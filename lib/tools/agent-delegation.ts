import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  agentKeys,
  delegationTargetsByAgent,
  resolveAgentDefinition,
  type AgentKey,
} from "@/lib/agents/registry";
import { getDatabase } from "@/lib/db/postgres";
import { locatedError } from "@/lib/errors/located";
import type { LLMToolCall } from "@/lib/llm/types";
import type { PreparedAgentTurn } from "@/lib/runs/worker-store";

const delegationInputSchema = z
  .object({
    task: z.string().trim().min(1).max(4_000),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

function targetFromToolName(name: string): AgentKey | null {
  if (!name.startsWith("delegate_to_")) return null;
  const target = name.slice("delegate_to_".length);
  return agentKeys.includes(target as AgentKey) ? (target as AgentKey) : null;
}

function effectKey(runId: string, call: LLMToolCall) {
  return createHash("sha256")
    .update(`${runId}:${call.id}:${call.name}:${call.arguments}`)
    .digest("hex");
}

export function isAgentDelegationTool(name: string) {
  return targetFromToolName(name) !== null;
}

async function executeAgentDelegationToolInternal(
  turn: PreparedAgentTurn,
  call: LLMToolCall,
) {
  const target = targetFromToolName(call.name);
  if (!target) throw new Error(`DELEGATION_TOOL_UNKNOWN:${call.name}`);
  if (!delegationTargetsByAgent[turn.agentKey].includes(target as never)) {
    throw new Error(`DELEGATION_TARGET_NOT_ALLOWED:${turn.agentKey}:${target}`);
  }
  if (!call.id) throw new Error(`TOOL_CALL_ID_REQUIRED:${call.name}`);

  let input: z.infer<typeof delegationInputSchema>;
  try {
    input = delegationInputSchema.parse(JSON.parse(call.arguments || "{}"));
  } catch {
    return {
      toolCallId: call.id,
      content: JSON.stringify({
        ok: false,
        error: "DELEGATION_ARGUMENTS_INVALID",
      }),
      delegatedAgentKey: null,
    };
  }

  const strictSelection = turn.scheduleStrategy === "user_selected";
  if (strictSelection && !turn.agentKeys.includes(target)) {
    return {
      toolCallId: call.id,
      content: JSON.stringify({
        ok: false,
        error: "AGENT_OUTSIDE_USER_SELECTION",
        target,
      }),
      delegatedAgentKey: null,
    };
  }

  const sql = getDatabase();
  const definition = resolveAgentDefinition(target);
  await sql.begin(async (transaction) => {
    await transaction`
      insert into public.project_agent_assignments (
        project_id, agent_key, definition_version, source, status, assigned_run_id
      ) values (
        ${turn.projectId}::uuid, ${target}, ${definition.version}, 'automatic',
        'assigned', ${turn.runId}::uuid
      )
      on conflict (project_id, agent_key, removed_at) do update
      set definition_version = excluded.definition_version,
          assigned_run_id = excluded.assigned_run_id,
          status = case
            when public.project_agent_assignments.assigned_run_id = excluded.assigned_run_id
              then public.project_agent_assignments.status
            else 'assigned'::public.assignment_status
          end,
          updated_at = now()
    `;
    await transaction`
      insert into public.run_agent_states (
        run_id, project_id, agent_key, definition_version, status, current_step,
        parent_agent_key
      ) values (
        ${turn.runId}::uuid, ${turn.projectId}::uuid, ${target},
        ${definition.version}, 'assigned', 'delegated', ${turn.agentKey}
      )
      on conflict (run_id, agent_key) do nothing
    `;
    const invocationRows = await transaction<Array<{ id: string }>>`
      insert into public.tool_invocations (
        project_id, run_id, agent_key, tool_key, tool_version, effect_key,
        status, input_redacted, output_redacted, started_at, completed_at
      ) values (
        ${turn.projectId}::uuid, ${turn.runId}::uuid, ${turn.agentKey},
        ${call.name}, 1, ${effectKey(turn.runId, call)}, 'completed',
        ${transaction.json(input)},
        ${transaction.json({ delegatedAgentKey: target })}, now(), now()
      )
      on conflict (effect_key) do update set effect_key = excluded.effect_key
      returning id::text
    `;
    const sequenceRows = await transaction<
      Array<{ last_event_sequence: string }>
    >`
      update public.agent_runs
      set last_event_sequence = last_event_sequence + 1,
          agent_plan_snapshot = jsonb_set(
            agent_plan_snapshot,
            '{agents}',
            case
              when coalesce(agent_plan_snapshot -> 'agents', '[]'::jsonb) ? ${target}
                then coalesce(agent_plan_snapshot -> 'agents', '[]'::jsonb)
              else coalesce(agent_plan_snapshot -> 'agents', '[]'::jsonb) || to_jsonb(${target}::text)
            end
          )
      where id = ${turn.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    if (!sequenceRows[0]) return;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary,
        detail, tool_invocation_id
      ) values (
        ${turn.projectId}::uuid, ${turn.runId}::uuid, ${turn.agentKey},
        ${Number(sequenceRows[0].last_event_sequence)}, 'agent.delegated', 'completed',
        ${`${resolveAgentDefinition(turn.agentKey).displayName} 已调度 ${definition.displayName}`},
        ${transaction.json({ target, task: input.task, reason: input.reason })},
        ${invocationRows[0]?.id ?? null}::uuid
      )
    `;
  });

  return {
    toolCallId: call.id,
    content: JSON.stringify({ ok: true, delegatedAgentKey: target }),
    delegatedAgentKey: target,
  };
}

export async function executeAgentDelegationTool(
  turn: PreparedAgentTurn,
  call: LLMToolCall,
) {
  try {
    return await executeAgentDelegationToolInternal(turn, call);
  } catch (error) {
    throw locatedError(
      error,
      "AGENT_DELEGATION_FAILED",
      "lib/tools/agent-delegation.executeAgentDelegationTool",
    );
  }
}
