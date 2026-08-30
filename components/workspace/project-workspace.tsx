"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  AlertTriangle,
  Bot,
  Braces,
  ChevronDown,
  CircleStop,
  Code2,
  Eye,
  FileCode2,
  GitBranch,
  History,
  Home,
  LoaderCircle,
  Play,
  Radio,
  RefreshCw,
  Rocket,
  ScrollText,
  TerminalSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api/client";
import { agentNamesForRun, workingAgentLabel } from "@/lib/agents/presentation";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { shouldSubmitTextareaOnEnter } from "@/lib/forms/submit-on-enter";
import type { ConversationMessage } from "@/lib/chat/repository";
import type { ProjectSummary } from "@/lib/projects/types";
import type { AgentRun } from "@/lib/runs/repository";
import { runFailureMessage } from "@/lib/runs/failure";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type CanvasView = "editor" | "terminal" | "preview" | "trace";
type AgentInfo = {
  key: string;
  version: number;
  name: string;
  description: string;
  avatarPath: string | null;
  tools: string[];
  assigned: boolean;
  status: string | null;
  runId: string | null;
};

type TraceEvent = {
  id: string;
  sequence: number;
  event_type: string;
  status: string;
  summary: string;
  detail: Record<string, unknown>;
  agent_key: string | null;
  created_at: string;
};

const views: Array<{ key: CanvasView; label: string; icon: React.ReactNode }> =
  [
    { key: "editor", label: "Editor", icon: <Code2 size={15} /> },
    { key: "terminal", label: "Terminal", icon: <TerminalSquare size={15} /> },
    { key: "preview", label: "Web Preview", icon: <Eye size={15} /> },
    { key: "trace", label: "Trace", icon: <ScrollText size={15} /> },
  ];

function messageText(message: ConversationMessage) {
  const value = message.content.text ?? message.content.summary ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CanvasView>("editor");
  const [follow, setFollow] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [modeOverride, setModeOverride] = useState<"engineer" | "team" | null>(
    null,
  );
  const [scheduleStrategyOverride, setScheduleStrategyOverride] = useState<
    "automatic" | "user_selected" | null
  >(null);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiRequest<ProjectSummary>(`/api/v1/projects/${projectId}`),
  });
  const messagesQuery = useQuery({
    queryKey: ["messages", projectId],
    queryFn: () =>
      apiRequest<ConversationMessage[]>(
        `/api/v1/projects/${projectId}/messages?after=0&limit=100`,
      ),
    refetchInterval: () => (projectQuery.data?.activeRunId ? 750 : false),
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () =>
      apiRequest<AgentInfo[]>(`/api/v1/projects/${projectId}/agents`),
  });

  const activeRunId = projectQuery.data?.activeRunId ?? null;
  const observedRunId = activeRunId ?? projectQuery.data?.latestRunId ?? null;
  const runQuery = useQuery({
    queryKey: ["run", observedRunId],
    queryFn: () => apiRequest<AgentRun>(`/api/v1/runs/${observedRunId}`),
    enabled: Boolean(observedRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ["completed", "failed", "cancelled"].includes(status)
        ? false
        : 2500;
    },
  });
  const eventsQuery = useQuery({
    queryKey: ["events", observedRunId],
    queryFn: () =>
      apiRequest<TraceEvent[]>(
        `/api/v1/runs/${observedRunId}/events?after=0&limit=200`,
      ),
    enabled: Boolean(observedRunId),
    refetchInterval: () => {
      const status = runQuery.data?.status;
      return status && ["completed", "failed", "cancelled"].includes(status)
        ? false
        : 2500;
    },
  });
  const mode = modeOverride ?? projectQuery.data?.defaultMode ?? "engineer";
  const scheduleStrategy =
    scheduleStrategyOverride ??
    projectQuery.data?.defaultScheduleStrategy ??
    "automatic";

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`project:${projectId}`, { config: { private: true } })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `project_id=eq.${projectId}`,
        },
        () =>
          queryClient.invalidateQueries({ queryKey: ["messages", projectId] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_runs",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
          queryClient.invalidateQueries({ queryKey: ["project", projectId] });
          queryClient.invalidateQueries({ queryKey: ["run"] });
          queryClient.invalidateQueries({ queryKey: ["events"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trace_events",
          filter: `project_id=eq.${projectId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["events"] }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_agent_assignments",
          filter: `project_id=eq.${projectId}`,
        },
        () =>
          queryClient.invalidateQueries({ queryKey: ["agents", projectId] }),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, queryClient]);

  useEffect(() => {
    if (!observedRunId || runQuery.data?.lastEventSequence === undefined)
      return;
    void queryClient.invalidateQueries({ queryKey: ["events", observedRunId] });
  }, [observedRunId, queryClient, runQuery.data?.lastEventSequence]);

  const sendMessage = useMutation({
    mutationFn: (message: string) =>
      apiRequest<{ messageId: string; runId: string }>(
        `/api/v1/projects/${projectId}/messages`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            message,
            mode,
            scheduleStrategy,
            agentKeys:
              scheduleStrategy === "user_selected" ? selectedAgents : [],
          }),
        },
      ),
    onSuccess: async () => {
      setPrompt("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["agents", projectId] }),
      ]);
    },
  });

  const cancelRun = useMutation({
    mutationFn: () =>
      apiRequest<{ status: string }>(`/api/v1/runs/${activeRunId}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["run", activeRunId] }),
  });

  const selectedTrace = useMemo(() => {
    const events = eventsQuery.data ?? [];
    return (
      events.find((event) => event.id === selectedTraceId) ??
      (view === "trace" ? events.at(-1) : null) ??
      null
    );
  }, [eventsQuery.data, selectedTraceId, view]);

  if (projectQuery.isLoading) {
    return (
      <main className="full-state">
        <LoaderCircle className="spin" /> 正在打开项目
      </main>
    );
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <main className="full-state error">
        <strong>项目无法打开</strong>
        <p>{projectQuery.error?.message}</p>
        <Link className="secondary-button" href="/dashboard">
          返回 Dashboard
        </Link>
      </main>
    );
  }

  const project = projectQuery.data;
  const runIsActive =
    runQuery.data &&
    !["completed", "failed", "cancelled"].includes(runQuery.data.status);
  const failedRun = runQuery.data?.status === "failed" ? runQuery.data : null;
  const workingAgentNames = agentNamesForRun(
    agentsQuery.data ?? [],
    runQuery.data?.id ?? null,
  );

  async function openRunTrace() {
    setView("trace");
    setFollow(false);
    const result = await eventsQuery.refetch();
    const events = result.data ?? eventsQuery.data ?? [];
    const failureEvent = events.findLast((event) => event.status === "failed");
    setSelectedTraceId(failureEvent?.id ?? null);
  }

  function openTrace(message: ConversationMessage) {
    const eventId =
      typeof message.content.eventId === "string"
        ? message.content.eventId
        : null;
    setSelectedTraceId(eventId);
    setView("trace");
    setFollow(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || sendMessage.isPending || runIsActive) return;
    sendMessage.mutate(message);
  }

  return (
    <main className="workspace-shell">
      <section className="chat-pane">
        <header className="chat-topbar">
          <Link
            href="/dashboard"
            className="icon-button"
            aria-label="返回 Dashboard"
            title="主页"
          >
            <Home size={17} />
          </Link>
          <div className="project-title">
            <strong>{project.name}</strong>
            <span
              className={`run-indicator ${runQuery.data?.status ?? project.status}`}
            >
              {runQuery.data?.status ?? project.status}
            </span>
          </div>
          <button
            className={`icon-button ${historyOpen ? "active" : ""}`}
            aria-label="查看项目历史"
            title="项目历史"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History size={17} />
          </button>
        </header>

        {historyOpen ? (
          <aside className="history-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">PROJECT HISTORY</p>
                <strong>对话时间线</strong>
              </div>
              <button
                className="icon-button"
                onClick={() => setHistoryOpen(false)}
                aria-label="关闭历史"
              >
                <X size={16} />
              </button>
            </div>
            {(messagesQuery.data ?? []).map((message) => (
              <button
                key={message.id}
                className="history-item"
                onClick={() => setHistoryOpen(false)}
              >
                <span>#{message.sequence}</span>
                <p>{messageText(message).slice(0, 72) || message.kind}</p>
              </button>
            ))}
          </aside>
        ) : null}

        <div className="chat-timeline" aria-live="polite">
          {messagesQuery.isLoading ? (
            <div className="timeline-state">
              <LoaderCircle className="spin" size={17} /> 加载对话
            </div>
          ) : null}
          {!messagesQuery.isLoading && messagesQuery.data?.length === 0 ? (
            <div className="timeline-state">
              <Bot size={21} />
              <p>项目已创建，发送消息开始第一次执行。</p>
            </div>
          ) : null}
          {(messagesQuery.data ?? []).map((message) => (
            <article
              key={message.id}
              className={`chat-message ${message.role} ${message.kind}`}
            >
              <div className="message-meta">
                <span>
                  {message.role === "user"
                    ? "You"
                    : (message.agentKey ?? "Neurons")}
                </span>
                <small>#{message.sequence}</small>
              </div>
              <MarkdownMessage
                content={messageText(message)}
                streaming={message.status === "streaming"}
              />
              {["thought_summary", "tool_summary"].includes(message.kind) ? (
                <button
                  className="trace-link"
                  onClick={() => openTrace(message)}
                >
                  <Braces size={14} /> 在 Trace 中查看
                </button>
              ) : null}
            </article>
          ))}
          {runIsActive ? (
            <div className="running-card">
              <span className="pulse" />
              <div>
                <strong>{workingAgentLabel(workingAgentNames)}</strong>
                <p>{runQuery.data?.status.replaceAll("_", " ")}</p>
              </div>
              <button
                className="icon-button"
                aria-label="停止任务"
                title="停止任务"
                onClick={() => cancelRun.mutate()}
                disabled={cancelRun.isPending}
              >
                <CircleStop size={17} />
              </button>
            </div>
          ) : null}
          {failedRun ? (
            <div className="run-result-card failed" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <div>
                <strong>任务执行失败</strong>
                <p>{runFailureMessage(failedRun.failureCode)}</p>
              </div>
              <button
                className="text-button"
                onClick={() => void openRunTrace()}
              >
                查看 Trace
              </button>
            </div>
          ) : null}
          {runQuery.isError ? (
            <p className="inline-error" role="alert">
              执行结果加载失败：{runQuery.error.message}
            </p>
          ) : null}
          {cancelRun.error ? (
            <p className="inline-error" role="alert">
              停止任务失败：{cancelRun.error.message} 请重试。
            </p>
          ) : null}
        </div>

        <form className="workspace-composer" onSubmit={submit}>
          {mode === "team" && scheduleStrategy === "user_selected" ? (
            <div className="agent-picker">
              {(agentsQuery.data ?? []).map((agent) => (
                <label key={agent.key}>
                  <input
                    type="checkbox"
                    checked={selectedAgents.includes(agent.key)}
                    onChange={(event) =>
                      setSelectedAgents((current) =>
                        event.target.checked
                          ? [...current, agent.key]
                          : current.filter((key) => key !== agent.key),
                      )
                    }
                  />
                  {agent.name}
                </label>
              ))}
            </div>
          ) : null}
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                !shouldSubmitTextareaOnEnter({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                })
              )
                return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={
              runIsActive
                ? "可以先输入下一条需求，当前任务结束后即可发送…"
                : "描述下一步修改…"
            }
            rows={3}
          />
          <div className="composer-footer">
            <div className="composer-selects">
              <label>
                <span className="sr-only">模式</span>
                <select
                  value={mode}
                  onChange={(event) =>
                    setModeOverride(event.target.value as "engineer" | "team")
                  }
                >
                  <option value="engineer">Engineer</option>
                  <option value="team">Team</option>
                </select>
              </label>
              {mode === "team" ? (
                <label>
                  <span className="sr-only">调度方式</span>
                  <select
                    value={scheduleStrategy}
                    onChange={(event) =>
                      setScheduleStrategyOverride(
                        event.target.value as "automatic" | "user_selected",
                      )
                    }
                  >
                    <option value="automatic">默认调度</option>
                    <option value="user_selected">指定 Agent</option>
                  </select>
                </label>
              ) : null}
            </div>
            <button
              className="send-button"
              disabled={
                !prompt.trim() || sendMessage.isPending || Boolean(runIsActive)
              }
              aria-label="发送消息"
            >
              {sendMessage.isPending ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
          {sendMessage.error ? (
            <p className="inline-error">{sendMessage.error.message}</p>
          ) : null}
        </form>
      </section>

      <section className="canvas-pane">
        <header className="canvas-globalbar">
          <div className="project-actions">
            <button className="top-action">
              <GitBranch size={15} /> 项目
            </button>
            <button className="top-action">
              <Radio size={15} /> 版本
            </button>
            <button
              className="publish-button"
              disabled={!project.latestSuccessfulVersionId}
            >
              <Rocket size={15} /> Publish
            </button>
          </div>
        </header>
        <div className="canvas-toolbar">
          <nav className="view-tabs" aria-label="画布视图">
            {views.map((item) => (
              <button
                key={item.key}
                className={view === item.key ? "active" : ""}
                onClick={() => {
                  setView(item.key);
                  setFollow(false);
                }}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </nav>
          <div className="canvas-controls">
            <button
              className={`follow-button ${follow ? "active" : ""}`}
              onClick={() => setFollow((value) => !value)}
              aria-pressed={follow}
            >
              {follow ? (
                <Play size={13} fill="currentColor" />
              ) : (
                <CircleStop size={13} />
              )}
              {follow ? "跟随中" : "已暂停"}
            </button>
            <div className="agent-avatars" aria-label="Agent 分配">
              {(agentsQuery.data ?? []).map((agent) => (
                <button
                  key={agent.key}
                  className={`agent-avatar ${agent.assigned ? "assigned" : ""}`}
                  aria-label={`${agent.name}，${agent.assigned ? "已分配" : "未分配"}`}
                >
                  {agent.name.slice(0, 1).toUpperCase()}
                  <span className="agent-tooltip">
                    <strong>{agent.name}</strong>
                    <p>{agent.description}</p>
                    <small>
                      {agent.tools.length
                        ? agent.tools.join(" · ")
                        : "尚未配置 Tools"}
                    </small>
                  </span>
                </button>
              ))}
              {!agentsQuery.isLoading && agentsQuery.data?.length === 0 ? (
                <span className="agents-empty" title="Agent 配置待设计">
                  No agents
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={`canvas-content view-${view}`}>
          {view === "editor" ? (
            <div className="editor-surface">
              <aside className="file-tree">
                <div className="file-tree-title">
                  EXPLORER <ChevronDown size={13} />
                </div>
                <div className="empty-tree">
                  项目文件会在 Sandbox 启动后出现
                </div>
              </aside>
              <div className="editor-empty canvas-empty">
                <FileCode2 size={28} />
                <strong>还没有打开文件</strong>
                <p>开启跟随后，Agent 的真实文件操作会自动定位到这里。</p>
              </div>
            </div>
          ) : null}
          {view === "terminal" ? (
            <div className="terminal-surface">
              <div className="terminal-title">
                <TerminalSquare size={14} /> TERMINAL
              </div>
              <div className="canvas-empty dark-empty">
                <span className="terminal-prompt">$</span>
                <strong>暂无终端会话</strong>
                <p>Agent 执行真实命令后，输出会按顺序显示并可在刷新后恢复。</p>
              </div>
            </div>
          ) : null}
          {view === "preview" ? (
            <div className="preview-surface">
              <div className="preview-addressbar">
                <button aria-label="刷新预览" disabled>
                  <RefreshCw size={14} />
                </button>
                <span>Preview unavailable</span>
              </div>
              <div className="canvas-empty">
                <Eye size={28} />
                <strong>还没有可用预览</strong>
                <p>成功启动 Sandbox 开发服务器后，结果会在隔离页面中显示。</p>
              </div>
            </div>
          ) : null}
          {view === "trace" ? (
            <div className="trace-surface">
              <aside className="trace-list">
                <div className="trace-list-title">RUN TRACE</div>
                {eventsQuery.isLoading ||
                (eventsQuery.isFetching && !eventsQuery.data?.length) ? (
                  <p className="muted">加载中…</p>
                ) : null}
                {(eventsQuery.data ?? []).map((event) => (
                  <button
                    key={event.id}
                    className={selectedTrace?.id === event.id ? "active" : ""}
                    onClick={() => setSelectedTraceId(event.id)}
                  >
                    <span>#{event.sequence}</span>
                    <div>
                      <strong>{event.event_type}</strong>
                      <small>{event.summary || event.status}</small>
                    </div>
                  </button>
                ))}
                {!eventsQuery.isFetching &&
                !eventsQuery.isError &&
                eventsQuery.data?.length === 0 ? (
                  <p className="empty-trace">当前 Run 还没有可见 Trace。</p>
                ) : null}
                {eventsQuery.isError ? (
                  <div className="empty-trace" role="alert">
                    <p>Trace 加载失败：{eventsQuery.error.message}</p>
                    <button
                      className="text-button"
                      onClick={() => void eventsQuery.refetch()}
                    >
                      重新加载
                    </button>
                  </div>
                ) : null}
              </aside>
              <article className="trace-detail">
                {selectedTrace ? (
                  <>
                    <p className="eyebrow">EVENT #{selectedTrace.sequence}</p>
                    <h2>{selectedTrace.event_type}</h2>
                    <p>{selectedTrace.summary}</p>
                    <pre>{JSON.stringify(selectedTrace.detail, null, 2)}</pre>
                  </>
                ) : (
                  <div className="canvas-empty">
                    <ScrollText size={28} />
                    <strong>选择一个执行节点</strong>
                    <p>对话中的关键 Thought 与 Tool Call 也会定位到这里。</p>
                  </div>
                )}
              </article>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
