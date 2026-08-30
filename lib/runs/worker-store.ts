import "server-only";

import {
  agentKeys,
  ENGINEER_AGENT_KEY,
  resolveAgentDefinition,
  type AgentKey,
} from "@/lib/agents/registry";
import { getDatabase } from "@/lib/db/postgres";
import { locatedError } from "@/lib/errors/located";
import type { LLMToolCall, LLMUsage } from "@/lib/llm/types";

export type PreparedAgentRun = {
  runId: string;
  projectId: string;
  conversationId: string;
  ownerId: string;
  prompt: string;
  mode: "engineer" | "team";
  scheduleStrategy: "automatic" | "user_selected";
  agentKeys: AgentKey[];
};

export type PreparedAgentTurn = PreparedAgentRun & {
  agentKey: AgentKey;
  assistantMessageId: string;
};

export type AgentTurnOutput = {
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage | null;
};

function isAgentKey(value: string): value is AgentKey {
  return agentKeys.includes(value as AgentKey);
}

export async function prepareAgentRun(
  runId: string,
): Promise<PreparedAgentRun> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const rows = await transaction<
      Array<{
        id: string;
        project_id: string;
        conversation_id: string;
        owner_id: string;
        mode: "engineer" | "team";
        schedule_strategy: "automatic" | "user_selected";
        status: string;
        prompt: string;
      }>
    >`
      select run.id, run.project_id, run.conversation_id, run.owner_id,
             run.mode::text, run.schedule_strategy::text, run.status::text,
             coalesce(run_message.content ->> 'text', '') as prompt
      from public.agent_runs run
      join public.messages run_message on run_message.id = run.trigger_message_id
      where run.id = ${runId}::uuid
      for update of run
    `;
    const run = rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (!["queued", "planning"].includes(run.status)) {
      throw new Error(`RUN_NOT_CLAIMABLE:${run.status}`);
    }

    const assignmentRows = await transaction<Array<{ agent_key: string }>>`
      select agent_key
      from public.project_agent_assignments
      where project_id = ${run.project_id}::uuid
        and assigned_run_id = ${run.id}::uuid
        and removed_at is null
    `;
    const assigned = new Set(
      assignmentRows.map((row) => row.agent_key).filter(isAgentKey),
    );
    const selectedAgents =
      run.mode === "engineer"
        ? [ENGINEER_AGENT_KEY]
        : agentKeys.filter((key) => assigned.has(key));
    if (!selectedAgents.length) throw new Error("TEAM_AGENT_SELECTION_EMPTY");

    const eventRows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set status = 'running', started_at = coalesce(started_at, now()),
          last_event_sequence = last_event_sequence + 1,
          agent_plan_snapshot = ${transaction.json({
            kind: run.mode,
            agents: selectedAgents,
            execution: "sequential",
          })}
      where id = ${run.id}::uuid
      returning last_event_sequence::text
    `;
    const sequence = Number(eventRows[0]?.last_event_sequence);

    for (const agentKey of selectedAgents) {
      const definition = resolveAgentDefinition(agentKey);
      await transaction`
        insert into public.project_agent_assignments (
          project_id, agent_key, definition_version, source, status, assigned_run_id
        ) values (
          ${run.project_id}::uuid, ${agentKey}, ${definition.version}, 'system',
          'assigned', ${run.id}::uuid
        )
        on conflict (project_id, agent_key, removed_at) do update
        set definition_version = excluded.definition_version,
            status = 'assigned', assigned_run_id = excluded.assigned_run_id,
            updated_at = now()
      `;
      await transaction`
        insert into public.run_agent_states (
          run_id, project_id, agent_key, definition_version, status, current_step
        ) values (
          ${run.id}::uuid, ${run.project_id}::uuid, ${agentKey},
          ${definition.version}, 'assigned', 'queued'
        )
        on conflict (run_id, agent_key) do update
        set status = 'assigned', current_step = 'queued', updated_at = now()
      `;
    }

    await transaction`
      insert into public.trace_events (
        project_id, run_id, sequence, event_type, status, summary, detail
      ) values (
        ${run.project_id}::uuid, ${run.id}::uuid, ${sequence},
        'run.started', 'started',
        ${run.mode === "team" ? "Team Mode 已开始执行" : "Engineer Mode 已开始执行"},
        ${transaction.json({ mode: run.mode, agents: selectedAgents })}
      )
    `;

    return {
      runId: run.id,
      projectId: run.project_id,
      conversationId: run.conversation_id,
      ownerId: run.owner_id,
      prompt: run.prompt,
      mode: run.mode,
      scheduleStrategy: run.schedule_strategy,
      agentKeys: selectedAgents,
    };
  });
}

export async function beginAgentTurn(
  run: PreparedAgentRun,
  agentKey: AgentKey,
  previousAgentKey: AgentKey | null,
): Promise<PreparedAgentTurn> {
  const sql = getDatabase();
  const definition = resolveAgentDefinition(agentKey);
  return sql.begin(async (transaction) => {
    const sequenceRows = await transaction<Array<{ last_sequence: string }>>`
      update public.conversations
      set last_sequence = last_sequence + 1
      where id = ${run.conversationId}::uuid
      returning last_sequence::text
    `;
    const messageSequence = Number(sequenceRows[0]?.last_sequence);
    const messageRows = await transaction<Array<{ id: string }>>`
      insert into public.messages (
        project_id, conversation_id, owner_id, run_id, agent_key, sequence,
        role, kind, status, content, client_request_id
      ) values (
        ${run.projectId}::uuid, ${run.conversationId}::uuid, ${run.ownerId}::uuid,
        ${run.runId}::uuid, ${agentKey}, ${messageSequence}, 'assistant', 'text',
        'streaming', jsonb_build_object('text', ''),
        ${`workflow:${run.runId}:assistant:${agentKey}`}
      )
      returning id::text
    `;
    const assistantMessage = messageRows[0];
    if (!assistantMessage) throw new Error("ASSISTANT_MESSAGE_CREATE_FAILED");

    await transaction`
      update public.project_agent_assignments
      set status = case when agent_key = ${agentKey} then 'active' else status end,
          updated_at = now()
      where project_id = ${run.projectId}::uuid
        and assigned_run_id = ${run.runId}::uuid and removed_at is null
    `;
    await transaction`
      update public.run_agent_states
      set status = 'running', current_step = 'responding',
          started_at = coalesce(started_at, now()), updated_at = now()
      where run_id = ${run.runId}::uuid and agent_key = ${agentKey}
    `;
    const eventRows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set last_event_sequence = last_event_sequence + 1
      where id = ${run.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    const eventSequence = Number(eventRows[0]?.last_event_sequence);
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, ${agentKey}, ${eventSequence},
        ${previousAgentKey ? "agent.handoff" : "agent.started"}, 'started',
        ${
          previousAgentKey
            ? `${resolveAgentDefinition(previousAgentKey).displayName} 已交接给 ${definition.displayName}`
            : `${definition.displayName} 已开始处理请求`
        },
        ${transaction.json({ from: previousAgentKey, to: agentKey })}
      )
    `;

    return { ...run, agentKey, assistantMessageId: assistantMessage.id };
  });
}

export async function updateAssistantStream(messageId: string, text: string) {
  const sql = getDatabase();
  try {
    await sql`
      update public.messages
      set content = jsonb_build_object('text', ${text}::text), status = 'streaming'
      where id = ${messageId}::uuid and status = 'streaming'
        and content ->> 'text' is distinct from ${text}::text
    `;
  } catch (error) {
    throw locatedError(
      error,
      "ASSISTANT_STREAM_PERSIST_FAILED",
      "lib/runs/worker-store.updateAssistantStream",
    );
  }
}

export async function completeAgentTurn(
  turn: PreparedAgentTurn,
  output: AgentTurnOutput,
) {
  const sql = getDatabase();
  const definition = resolveAgentDefinition(turn.agentKey);
  await sql.begin(async (transaction) => {
    await transaction`
      update public.messages
      set content = jsonb_build_object('text', ${output.text}::text),
          status = 'completed', completed_at = now()
      where id = ${turn.assistantMessageId}::uuid and status = 'streaming'
    `;
    await transaction`
      update public.run_agent_states
      set status = 'completed', current_step = null, completed_at = now(), updated_at = now()
      where run_id = ${turn.runId}::uuid and agent_key = ${turn.agentKey}
    `;
    await transaction`
      update public.project_agent_assignments
      set status = 'completed', updated_at = now()
      where project_id = ${turn.projectId}::uuid and agent_key = ${turn.agentKey}
        and assigned_run_id = ${turn.runId}::uuid and removed_at is null
    `;
    const eventRows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set last_event_sequence = last_event_sequence + 1
      where id = ${turn.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    if (!eventRows[0]) return;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${turn.projectId}::uuid, ${turn.runId}::uuid, ${turn.agentKey},
        ${Number(eventRows[0].last_event_sequence)}, 'agent.completed', 'completed',
        ${`${definition.displayName} 已完成当前任务`},
        ${transaction.json({
          usage: output.usage,
          toolCalls: output.toolCalls.map(({ id, name }) => ({ id, name })),
        })}
      )
    `;
  });
}

export async function completeAgentRun(run: PreparedAgentRun) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const rows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set status = 'completed', completed_at = now(),
          last_event_sequence = last_event_sequence + 1,
          model_config_snapshot = jsonb_build_object('provider', 'openrouter')
      where id = ${run.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    if (!rows[0]) return;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, sequence, event_type, status, summary, detail
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid,
        ${Number(rows[0].last_event_sequence)}, 'run.completed', 'completed',
        '本轮 Agent Run 已完成', ${transaction.json({ agents: run.agentKeys })}
      )
    `;
    await transaction`
      update public.projects
      set active_run_id = null, status = 'ready', revision = revision + 1
      where id = ${run.projectId}::uuid and active_run_id = ${run.runId}::uuid
    `;
  });
}

export async function failAgentRun(
  runId: string,
  failureCode: string,
  failureDetail?: Record<string, unknown>,
) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const activeRows = await transaction<Array<{ agent_key: string }>>`
      select agent_key from public.run_agent_states
      where run_id = ${runId}::uuid and status = 'running'
      limit 1
    `;
    const rows = await transaction<
      Array<{ project_id: string; last_event_sequence: string }>
    >`
      update public.agent_runs
      set status = 'failed', failure_code = ${failureCode}::text, completed_at = now(),
          last_event_sequence = last_event_sequence + 1
      where id = ${runId}::uuid
        and status not in ('completed', 'failed', 'cancelled', 'cancelling')
      returning project_id::text, last_event_sequence::text
    `;
    const run = rows[0];
    if (!run) return;
    const activeAgentKey = activeRows[0]?.agent_key ?? null;
    await transaction`
      update public.messages
      set status = 'failed', completed_at = now()
      where run_id = ${runId}::uuid and role = 'assistant' and status = 'streaming'
    `;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.project_id}::uuid, ${runId}::uuid, ${activeAgentKey},
        ${Number(run.last_event_sequence)}, 'run.failed', 'failed',
        '任务执行失败', ${transaction.json({ code: failureCode, ...failureDetail })}
      )
    `;
    await transaction`
      update public.run_agent_states
      set status = 'failed', current_step = null, completed_at = now(), updated_at = now()
      where run_id = ${runId}::uuid and status in ('assigned', 'running', 'waiting')
    `;
    await transaction`
      update public.project_agent_assignments
      set status = 'failed', updated_at = now()
      where project_id = ${run.project_id}::uuid
        and assigned_run_id = ${runId}::uuid and removed_at is null
    `;
    await transaction`
      update public.projects
      set active_run_id = null, status = 'failed', revision = revision + 1
      where id = ${run.project_id}::uuid and active_run_id = ${runId}::uuid
    `;
  });
}
