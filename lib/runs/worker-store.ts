import "server-only";

import { getDatabase } from "@/lib/db/postgres";
import type { LLMToolCall, LLMUsage } from "@/lib/llm/types";

export type PreparedEngineerRun = {
  runId: string;
  projectId: string;
  conversationId: string;
  ownerId: string;
  assistantMessageId: string;
  prompt: string;
};

export async function prepareEngineerRun(runId: string): Promise<PreparedEngineerRun> {
  const sql = getDatabase();
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
        ${run.id}::uuid, 'p0-engineer', ${messageSequence},
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
            'kind', 'temporary_p0', 'agents', jsonb_build_array('p0-engineer')
          )
      where id = ${run.id}::uuid
      returning last_event_sequence::text
    `;
    const eventSequence = Number(eventRows[0]?.last_event_sequence);
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.project_id}::uuid, ${run.id}::uuid, 'p0-engineer', ${eventSequence},
        'model.started', 'started', 'Engineer 已开始处理请求',
        jsonb_build_object('temporaryDefinition', true)
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
  await sql`
    update public.messages
    set content = jsonb_build_object('text', ${text}), status = 'streaming'
    where id = ${messageId}::uuid and status = 'streaming'
  `;
}

export async function completeEngineerRun(
  run: PreparedEngineerRun,
  output: { text: string; toolCalls: LLMToolCall[]; usage: LLMUsage | null },
) {
  const sql = getDatabase();
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
      set content = jsonb_build_object('text', ${output.text}),
          status = 'completed', completed_at = now()
      where id = ${run.assistantMessageId}::uuid and status = 'streaming'
    `;
    await transaction`
      insert into public.trace_events (
        project_id, run_id, agent_key, sequence, event_type, status, summary, detail
      ) values (
        ${run.projectId}::uuid, ${run.runId}::uuid, 'p0-engineer',
        ${Number(completedRun.last_event_sequence)}, 'model.completed', 'completed',
        'Engineer 已完成本轮响应',
        ${transaction.json({ usage: output.usage, toolCalls: output.toolCalls })}
      )
    `;
    await transaction`
      update public.projects
      set active_run_id = null, status = 'ready', revision = revision + 1
      where id = ${run.projectId}::uuid and active_run_id = ${run.runId}::uuid
    `;
  });
}

export async function failAgentRun(runId: string, failureCode: string) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const rows = await transaction<
      Array<{ project_id: string; last_event_sequence: string }>
    >`
      update public.agent_runs
      set status = 'failed', failure_code = ${failureCode}, completed_at = now(),
          last_event_sequence = last_event_sequence + 1
      where id = ${runId}::uuid
        and status not in ('completed', 'failed', 'cancelled')
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
        ${run.project_id}::uuid, ${runId}::uuid, 'p0-engineer',
        ${Number(run.last_event_sequence)}, 'run.failed', 'failed',
        '任务执行失败', jsonb_build_object('code', ${failureCode})
      )
    `;
    await transaction`
      update public.projects
      set active_run_id = null, status = 'failed', revision = revision + 1
      where id = ${run.project_id}::uuid and active_run_id = ${runId}::uuid
    `;
  });
}
