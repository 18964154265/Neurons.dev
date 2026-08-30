import "server-only";

import {
  ENGINEER_AGENT_KEY,
  resolveAgentDefinition,
} from "@/lib/agents/registry";
import { getDatabase } from "@/lib/db/postgres";
import { locatedError } from "@/lib/errors/located";
import type { LLMToolCall, LLMUsage } from "@/lib/llm/types";

export type PreparedEngineerRun = {
  runId: string;
  projectId: string;
  conversationId: string;
  ownerId: string;
  assistantMessageId: string;
  prompt: string;
};

export async function prepareEngineerRun(
  runId: string,
): Promise<PreparedEngineerRun> {
  const sql = getDatabase();
  const engineer = resolveAgentDefinition(ENGINEER_AGENT_KEY);
  return sql.begin(async (transaction) => {
    const rows = await transaction<
      Array<{
        id: string;
        project_id: string;
        conversation_id: string;
        owner_id: string;
        mode: string;
        status: string;
        prompt: string;
      }>
    >`
      select run.id, run.project_id, run.conversation_id, run.owner_id,
             run.mode::text, run.status::text,
             coalesce(run_message.content ->> 'text', '') as prompt
      from public.agent_runs run
      join public.messages run_message on run_message.id = run.trigger_message_id
      where run.id = ${runId}::uuid
      for update of run
    `;
    const run = rows[0];
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.mode !== "engineer") throw new Error("TEAM_MODE_NOT_CONFIGURED");
    if (!["queued", "planning"].includes(run.status)) {
      throw new Error(`RUN_NOT_CLAIMABLE:${run.status}`);
    }

    const sequenceRows = await transaction<Array<{ last_sequence: string }>>`
      update public.conversations
      set last_sequence = last_sequence + 1
      where id = ${run.conversation_id}::uuid
      returning last_sequence::text
    `;
    const messageSequence = Number(sequenceRows[0]?.last_sequence);
    const messageRows = await transaction<Array<{ id: string }>>`
      insert into public.messages (
        project_id, conversation_id, owner_id, run_id, agent_key, sequence,
        role, kind, status, content, client_request_id
      ) values (
        ${run.project_id}::uuid, ${run.conversation_id}::uuid, ${run.owner_id}::uuid,
        ${run.id}::uuid, ${engineer.key}, ${messageSequence},
        'assistant', 'text', 'streaming', jsonb_build_object('text', ''),
        ${`workflow:${run.id}:assistant`}
      )
      returning id::text
    `;
    const assistantMessage = messageRows[0];
    if (!assistantMessage) throw new Error("ASSISTANT_MESSAGE_CREATE_FAILED");

    const eventRows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set status = 'running', started_at = coalesce(started_at, now()),
          last_event_sequence = last_event_sequence + 1,
          agent_plan_snapshot = jsonb_build_object(
            'kind', 'engineer', 'agents', jsonb_build_array(${engineer.key}::text)
          )
      where id = ${run.id}::uuid
      returning last_event_sequence::text
    `;
    const eventSequence = Number(eventRows[0]?.last_event_sequence);
    await transaction`
      insert into public.project_agent_assignments (
        project_id, agent_key, definition_version, source, status, assigned_run_id
      ) values (
        ${run.project_id}::uuid, ${engineer.key}, ${engineer.version},
        'system', 'active', ${run.id}::uuid
      )
      on conflict (project_id, agent_key, removed_at) do update
      set definition_version = excluded.definition_version,
          source = excluded.source,
          status = excluded.status,
          assigned_run_id = excluded.assigned_run_id,
          updated_at = now()
    `;
    await transaction`
      insert into public.run_agent_states (
        run_id, project_id, agent_key, definition_version, status, current_step, started_at
      ) values (
        ${run.id}::uuid, ${run.project_id}::uuid, ${engineer.key},
        ${engineer.version}, 'running', 'implement', now()
      )
      on conflict (run_id, agent_key) do update
      set status = 'running', current_step = 'implement',
          started_at = coalesce(run_agent_states.started_at, now()), updated_at = now()
    `;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.project_id}::uuid, ${run.id}::uuid, ${engineer.key}, ${eventSequence},
        'model.started', 'started', 'Alex 已开始处理请求',
        jsonb_build_object('definitionVersion', ${engineer.version}::integer)
      )
    `;

    return {
      runId: run.id,
      projectId: run.project_id,
      conversationId: run.conversation_id,
      ownerId: run.owner_id,
      assistantMessageId: assistantMessage.id,
      prompt: run.prompt,
    };
  });
}

export async function updateAssistantStream(messageId: string, text: string) {
  const sql = getDatabase();
  try {
    await sql`
      update public.messages
      set content = jsonb_build_object('text', ${text}::text), status = 'streaming'
      where id = ${messageId}::uuid and status = 'streaming'
    `;
  } catch (error) {
    throw locatedError(
      error,
      "ASSISTANT_STREAM_PERSIST_FAILED",
      "lib/runs/worker-store.updateAssistantStream",
    );
  }
}

export async function completeEngineerRun(
  run: PreparedEngineerRun,
  output: { text: string; toolCalls: LLMToolCall[]; usage: LLMUsage | null },
) {
  const sql = getDatabase();
  const engineer = resolveAgentDefinition(ENGINEER_AGENT_KEY);
  await sql.begin(async (transaction) => {
    const eventRows = await transaction<Array<{ last_event_sequence: string }>>`
      update public.agent_runs
      set status = 'completed', completed_at = now(),
          last_event_sequence = last_event_sequence + 1,
          model_config_snapshot = jsonb_build_object('provider', 'openrouter')
      where id = ${run.runId}::uuid and status = 'running'
      returning last_event_sequence::text
    `;
    const completedRun = eventRows[0];
    if (!completedRun) return;
    await transaction`
      update public.messages
      set content = jsonb_build_object('text', ${output.text}::text),
          status = 'completed', completed_at = now()
      where id = ${run.assistantMessageId}::uuid and status = 'streaming'
    `;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, ${engineer.key},
        ${Number(completedRun.last_event_sequence)}, 'model.completed', 'completed',
        'Alex 已完成本轮响应',
        ${transaction.json({ usage: output.usage, toolCalls: output.toolCalls })}
      )
    `;
    await transaction`
      update public.run_agent_states
      set status = 'completed', current_step = null, completed_at = now()
      where run_id = ${run.runId}::uuid and agent_key = ${engineer.key}
    `;
    await transaction`
      update public.project_agent_assignments
      set status = 'completed', updated_at = now()
      where project_id = ${run.projectId}::uuid and agent_key = ${engineer.key}
        and removed_at is null and assigned_run_id = ${run.runId}::uuid
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
  const engineer = resolveAgentDefinition(ENGINEER_AGENT_KEY);
  await sql.begin(async (transaction) => {
    const rows = await transaction<
      Array<{ project_id: string; last_event_sequence: string }>
    >`
      update public.agent_runs
      set status = 'failed', failure_code = ${failureCode}, completed_at = now(),
          last_event_sequence = last_event_sequence + 1
      where id = ${runId}::uuid
        and status not in ('completed', 'failed', 'cancelled', 'cancelling')
      returning project_id::text, last_event_sequence::text
    `;
    const run = rows[0];
    if (!run) return;
    await transaction`
      update public.messages
      set status = 'failed', completed_at = now()
      where run_id = ${runId}::uuid and role = 'assistant' and status = 'streaming'
    `;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.project_id}::uuid, ${runId}::uuid, ${engineer.key},
        ${Number(run.last_event_sequence)}, 'run.failed', 'failed',
        '任务执行失败', ${transaction.json({
          code: failureCode,
          ...failureDetail,
        })}
      )
    `;
    await transaction`
      update public.run_agent_states
      set status = 'failed', current_step = null, completed_at = now()
      where run_id = ${runId}::uuid and agent_key = ${engineer.key}
    `;
    await transaction`
      update public.project_agent_assignments
      set status = 'failed', updated_at = now()
      where project_id = ${run.project_id}::uuid and agent_key = ${engineer.key}
        and removed_at is null and assigned_run_id = ${runId}::uuid
    `;
    await transaction`
      update public.projects
      set active_run_id = null, status = 'failed', revision = revision + 1
      where id = ${run.project_id}::uuid and active_run_id = ${runId}::uuid
    `;
  });
}
