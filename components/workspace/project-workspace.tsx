"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  ArrowUp,
  AlertTriangle,
  Bot,
  Braces,
  ChevronDown,
  CircleStop,
  Check,
  Code2,
  Copy,
  Eye,
  FileCode2,
  Folder,
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
import { useEffect, useMemo, useRef, useState } from "react";

import { apiRequest } from "@/lib/api/client";
import { agentNamesForRun, workingAgentLabel } from "@/lib/agents/presentation";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { shouldSubmitTextareaOnEnter } from "@/lib/forms/submit-on-enter";
import type { ConversationMessage } from "@/lib/chat/repository";
import type { ProjectSummary } from "@/lib/projects/types";
import { buildStaticPreview } from "@/lib/preview/static-preview";
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

type ProjectFile = {
  path: string;
  content: string;
  language: string;
  revision: number;
  checksum: string;
  sourceRunId: string | null;
  sourceAgentKey: string | null;
  updatedAt: string;
};

type FileTreeRow =
  | { key: string; kind: "folder"; name: string; depth: number }
  | {
      key: string;
      kind: "file";
      name: string;
      depth: number;
      file: ProjectFile;
    };

function buildFileTreeRows(files: ProjectFile[]): FileTreeRow[] {
  type FolderNode = {
    folders: Map<string, FolderNode>;
    files: Array<{ name: string; file: ProjectFile }>;
  };
  const root: FolderNode = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    const fileName = parts.pop() ?? file.path;
    let node = root;
    for (const folderName of parts) {
      let folder = node.folders.get(folderName);
      if (!folder) {
        folder = { folders: new Map(), files: [] };
        node.folders.set(folderName, folder);
      }
      node = folder;
    }
    node.files.push({ name: fileName, file });
  }

  const rows: FileTreeRow[] = [];
  function visit(node: FolderNode, depth: number, parentPath: string) {
    for (const [name, folder] of [...node.folders].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      rows.push({ key: `folder:${path}`, kind: "folder", name, depth });
      visit(folder, depth + 1, path);
    }
    for (const entry of [...node.files].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      rows.push({
        key: `file:${entry.file.path}`,
        kind: "file",
        name: entry.name,
        depth,
        file: entry.file,
      });
    }
  }
  visit(root, 0, "");
  return rows;
}

const views: Array<{ key: CanvasView; label: string; icon: React.ReactNode }> =
  [
    { key: "editor", label: "Editor", icon: <Code2 size={16} /> },
    { key: "terminal", label: "Terminal", icon: <TerminalSquare size={16} /> },
    { key: "preview", label: "Web Preview", icon: <Eye size={16} /> },
    { key: "trace", label: "Trace", icon: <ScrollText size={16} /> },
  ];

function messageText(message: ConversationMessage) {
  const value = message.content.text ?? message.content.summary ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function traceVisual(event: TraceEvent) {
  const eventType = event.event_type.toLowerCase();
  if (event.status === "failed" || eventType.includes("error")) {
    return {
      kind: "error",
      icon: <AlertTriangle size={14} aria-hidden="true" />,
    };
  }
  if (event.status === "waiting" || event.status === "approval_required") {
    return {
      kind: "warning",
      icon: <AlertTriangle size={14} aria-hidden="true" />,
    };
  }
  if (eventType === "run.completed") {
    return {
      kind: "success",
      icon: <Check size={14} aria-hidden="true" />,
    };
  }
  if (eventType.startsWith("run.")) {
    return { kind: "run", icon: <Radio size={14} aria-hidden="true" /> };
  }
  if (eventType.startsWith("agent.")) {
    return { kind: "agent", icon: <Bot size={14} aria-hidden="true" /> };
  }
  if (eventType.startsWith("tool.")) {
    return { kind: "tool", icon: <Braces size={14} aria-hidden="true" /> };
  }
  if (eventType.startsWith("coding.")) {
    return { kind: "code", icon: <Code2 size={14} aria-hidden="true" /> };
  }
  if (eventType.startsWith("file.")) {
    return {
      kind: "file",
      icon: <FileCode2 size={14} aria-hidden="true" />,
    };
  }
  return { kind: "default", icon: <Braces size={14} aria-hidden="true" /> };
}

function traceDuration(event: TraceEvent) {
  const value = event.detail.durationMs ?? event.detail.duration_ms;
  if (typeof value !== "number") return null;
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`;
}

function traceTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function traceStatusLabel(status: string) {
  return (
    {
      started: "Started",
      progress: "In progress",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      waiting: "Waiting",
      approval_required: "Approval required",
    }[status] ?? status
  );
}

function traceAgentName(event: TraceEvent, agents: AgentInfo[]) {
  if (!event.agent_key) return "System";
  return (
    agents.find((agent) => agent.key === event.agent_key)?.name ??
    event.agent_key
  );
}

function traceMetadata(event: TraceEvent) {
  const metadata = event.detail.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

function tracePayload(event: TraceEvent) {
  const payload = Object.fromEntries(
    Object.entries(event.detail).filter(([key]) => key !== "metadata"),
  );
  return Object.keys(payload).length ? payload : null;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CanvasView>("editor");
  const [follow, setFollow] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [modeOverride, setModeOverride] = useState<"engineer" | "team" | null>(
    null,
  );
  const [scheduleStrategyOverride, setScheduleStrategyOverride] = useState<
    "automatic" | "user_selected" | null
  >(null);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedTraceAction, setCopiedTraceAction] = useState<string | null>(
    null,
  );
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  const pendingMessageUpdatesRef = useRef(
    new Map<string, Record<string, unknown>>(),
  );
  const messageUpdateFrameRef = useRef<number | null>(null);

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
    refetchInterval: () => (projectQuery.data?.activeRunId ? 1500 : false),
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () =>
      apiRequest<AgentInfo[]>(`/api/v1/projects/${projectId}/agents`),
    refetchInterval: () => (projectQuery.data?.activeRunId ? 500 : false),
  });
  const filesQuery = useQuery({
    queryKey: ["files", projectId],
    queryFn: () =>
      apiRequest<ProjectFile[]>(`/api/v1/projects/${projectId}/files`),
    refetchInterval: () => (projectQuery.data?.activeRunId ? 750 : false),
  });

  const activeRunId = projectQuery.data?.activeRunId ?? null;
  const observedRunId =
    activeRunId ?? selectedRunId ?? projectQuery.data?.latestRunId ?? null;
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
    const flushMessageUpdates = () => {
      messageUpdateFrameRef.current = null;
      if (!pendingMessageUpdatesRef.current.size) return;
      const updates = new Map(pendingMessageUpdatesRef.current);
      pendingMessageUpdatesRef.current.clear();
      queryClient.setQueryData<ConversationMessage[]>(
        ["messages", projectId],
        (current) =>
          current?.map((message) => {
            const row = updates.get(message.id);
            if (!row) return message;
            return {
              ...message,
              status:
                (row.status as ConversationMessage["status"] | undefined) ??
                message.status,
              content: (row.content ?? message.content) as Record<
                string,
                unknown
              >,
            };
          }),
      );
    };
    const scheduleMessageUpdate = (row: Record<string, unknown>) => {
      if (typeof row.id !== "string") return;
      pendingMessageUpdatesRef.current.set(row.id, row);
      if (messageUpdateFrameRef.current !== null) return;
      messageUpdateFrameRef.current =
        window.requestAnimationFrame(flushMessageUpdates);
    };
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
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as Record<string, unknown>;
          if (payload.eventType === "UPDATE" && typeof row.id === "string") {
            scheduleMessageUpdate(row);
            return;
          }
          queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
        },
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
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          queryClient.invalidateQueries({ queryKey: ["events"] });
          const row = payload.new as Record<string, unknown>;
          if (follow && row.event_type === "coding.started") setView("editor");
        },
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_files",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["files", projectId] });
          if (follow) setView("editor");
        },
      )
      .subscribe();

    return () => {
      if (messageUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(messageUpdateFrameRef.current);
      }
      flushMessageUpdates();
      void supabase.removeChannel(channel);
    };
  }, [follow, projectId, queryClient]);

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
      setSelectedRunId(null);
      setSelectedTraceId(null);
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
  const traceRuns = useMemo(() => {
    const seen = new Set<string>();
    return [...(messagesQuery.data ?? [])]
      .reverse()
      .filter((message) => {
        if (message.role !== "assistant" || !message.runId) return false;
        if (seen.has(message.runId)) return false;
        seen.add(message.runId);
        return true;
      })
      .map((message) => ({
        runId: message.runId!,
        sequence: message.sequence,
        agentKey: message.agentKey ?? "Agent",
      }));
  }, [messagesQuery.data]);
  const selectedFile = useMemo(() => {
    const files = filesQuery.data ?? [];
    const latestRunFile = follow
      ? files
          .filter((file) => file.sourceRunId === observedRunId)
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          )[0]
      : null;
    return (
      latestRunFile ??
      files.find((file) => file.path === selectedFilePath) ??
      files[0] ??
      null
    );
  }, [filesQuery.data, follow, observedRunId, selectedFilePath]);
  const fileTreeRows = useMemo(
    () => buildFileTreeRows(filesQuery.data ?? []),
    [filesQuery.data],
  );
  const staticPreview = useMemo(
    () => buildStaticPreview(filesQuery.data ?? []),
    [filesQuery.data],
  );

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
    if (message.runId) setSelectedRunId(message.runId);
    setView("trace");
    setFollow(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || sendMessage.isPending || runIsActive) return;
    sendMessage.mutate(message);
  }

  async function copyMessage(message: ConversationMessage) {
    try {
      await navigator.clipboard.writeText(messageText(message));
    } catch {
      return;
    }
    setCopiedMessageId(message.id);
    window.setTimeout(
      () =>
        setCopiedMessageId((current) =>
          current === message.id ? null : current,
        ),
      1500,
    );
  }

  async function copyTrace(event: TraceEvent, target: "event" | "json") {
    const value =
      target === "event"
        ? JSON.stringify(
            {
              id: event.id,
              sequence: event.sequence,
              eventType: event.event_type,
              status: event.status,
              summary: event.summary,
              agentKey: event.agent_key,
              createdAt: event.created_at,
              detail: event.detail,
            },
            null,
            2,
          )
        : JSON.stringify(tracePayload(event) ?? {}, null, 2);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    const actionId = `${event.id}:${target}`;
    setCopiedTraceAction(actionId);
    window.setTimeout(
      () =>
        setCopiedTraceAction((current) =>
          current === actionId ? null : current,
        ),
      1500,
    );
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
            <div
              key={message.id}
              className={`chat-message-wrap ${message.role} ${message.kind}`}
            >
              <article
                className={`chat-message ${message.role} ${message.kind}`}
              >
                <div className="message-meta">
                  <span>
                    {message.role === "user"
                      ? "You"
                      : ((agentsQuery.data ?? []).find(
                          (agent) => agent.key === message.agentKey,
                        )?.name ??
                        message.agentKey ??
                        "Neurons")}
                  </span>
                  <small>#{message.sequence}</small>
                </div>
                <MarkdownMessage
                  content={messageText(message)}
                  streaming={message.status === "streaming"}
                />
                {message.role === "assistant" && message.runId ? (
                  <button
                    className="trace-link"
                    onClick={() => openTrace(message)}
                  >
                    <Braces size={14} />
                    {["thought_summary", "tool_summary"].includes(message.kind)
                      ? "在 Trace 中查看"
                      : "查看本轮 Trace"}
                  </button>
                ) : null}
              </article>
              <button
                className="message-copy-button"
                type="button"
                aria-label="复制消息内容"
                title={copiedMessageId === message.id ? "已复制" : "复制"}
                onClick={() => void copyMessage(message)}
              >
                {copiedMessageId === message.id ? (
                  <Check size={13} />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            </div>
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

      <section
        className="canvas-pane"
        style={{ gridTemplateRows: "52px minmax(0, 1fr)" }}
      >
        <header className="canvas-globalbar canvas-toolbar">
          <nav className="view-tabs" aria-label="画布视图">
            {views.map((item) => (
              <button
                key={item.key}
                className={view === item.key ? "active" : ""}
                style={{ fontSize: "14px" }}
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
            <div className="project-actions">
              <button className="top-action">
                <GitBranch size={16} /> 项目
              </button>
              <button className="top-action">
                <Radio size={16} /> 版本
              </button>
              <button
                className="publish-button"
                disabled={!project.latestSuccessfulVersionId}
              >
                <Rocket size={16} /> Publish
              </button>
            </div>
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
        </header>

        <div className={`canvas-content view-${view}`}>
          {view === "editor" ? (
            <div className="editor-surface">
              <aside className="file-tree">
                <div className="file-tree-title">
                  EXPLORER <ChevronDown size={13} />
                </div>
                {filesQuery.isLoading ? (
                  <div className="empty-tree">正在加载项目文件…</div>
                ) : null}
                {fileTreeRows.map((row) =>
                  row.kind === "folder" ? (
                    <div
                      key={row.key}
                      className="file-tree-folder"
                      style={{ paddingLeft: 8 + row.depth * 14 }}
                    >
                      <ChevronDown size={13} />
                      <Folder size={14} />
                      <span>{row.name}</span>
                    </div>
                  ) : (
                    <button
                      key={row.key}
                      className={`file-tree-item ${selectedFile?.path === row.file.path ? "active" : ""}`}
                      style={{ paddingLeft: 24 + row.depth * 14 }}
                      onClick={() => {
                        setSelectedFilePath(row.file.path);
                        setFollow(false);
                      }}
                      title={`${row.file.path} · revision ${row.file.revision}`}
                    >
                      <FileCode2 size={14} />
                      <span>{row.name}</span>
                    </button>
                  ),
                )}
                {!filesQuery.isLoading && filesQuery.data?.length === 0 ? (
                  <div className="empty-tree">
                    Alex 写入项目文件后会显示在这里
                  </div>
                ) : null}
              </aside>
              {selectedFile ? (
                <section className="monaco-pane">
                  <div className="editor-filebar">
                    <span>{selectedFile.path}</span>
                    <small>revision {selectedFile.revision}</small>
                  </div>
                  <Editor
                    path={selectedFile.path}
                    language={selectedFile.language}
                    value={selectedFile.content}
                    theme="vs"
                    options={{
                      readOnly: true,
                      minimap: { enabled: true },
                      automaticLayout: true,
                      fontSize: 14,
                      scrollBeyondLastLine: false,
                    }}
                  />
                </section>
              ) : (
                <div className="editor-empty canvas-empty">
                  <FileCode2 size={28} />
                  <strong>还没有打开文件</strong>
                  <p>开启跟随后，Agent 的文件写入会自动定位到这里。</p>
                </div>
              )}
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
                <button
                  aria-label="刷新预览"
                  disabled={!staticPreview}
                  onClick={() => setPreviewRefreshToken((value) => value + 1)}
                >
                  <RefreshCw size={14} />
                </button>
                <span>
                  {staticPreview
                    ? `preview://${staticPreview.entryPath}`
                    : "Preview unavailable"}
                </span>
              </div>
              {staticPreview ? (
                <iframe
                  key={`${staticPreview.entryPath}:${previewRefreshToken}:${(
                    filesQuery.data ?? []
                  )
                    .map((file) => file.revision)
                    .join(".")}`}
                  className="static-preview-frame"
                  title="项目 Web Preview"
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  srcDoc={staticPreview.srcDoc}
                />
              ) : (
                <div className="canvas-empty">
                  <Eye size={28} />
                  <strong>还没有可用静态预览</strong>
                  <p>
                    让 Alex 通过 coding 生成 index.html；本地 CSS 和 JavaScript
                    会在隔离 iframe 中加载。
                  </p>
                </div>
              )}
            </div>
          ) : null}
          {view === "trace" ? (
            <div className="trace-surface">
              <aside className="trace-list">
                <div className="trace-list-title">RUN TRACE</div>
                {traceRuns.length ? (
                  <label className="trace-run-picker">
                    <span>执行轮次</span>
                    <select
                      value={observedRunId ?? ""}
                      onChange={(event) => {
                        setSelectedRunId(event.target.value);
                        setSelectedTraceId(null);
                      }}
                      disabled={Boolean(activeRunId)}
                    >
                      {traceRuns.map((run, index) => (
                        <option key={run.runId} value={run.runId}>
                          {index === 0 ? "最新 · " : ""}
                          {run.agentKey} 回复 #{run.sequence}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {eventsQuery.isLoading ||
                (eventsQuery.isFetching && !eventsQuery.data?.length) ? (
                  <p className="muted">加载中…</p>
                ) : null}
                {(eventsQuery.data ?? []).map((event) => {
                  const visual = traceVisual(event);
                  const duration = traceDuration(event);
                  return (
                    <button
                      key={event.id}
                      className={`trace-event-row trace-event-${visual.kind} ${
                        selectedTrace?.id === event.id ? "active" : ""
                      }`}
                      onClick={() => setSelectedTraceId(event.id)}
                    >
                      <span className="trace-event-node">{visual.icon}</span>
                      <div className="trace-event-content">
                        <div className="trace-event-heading">
                          <strong>{event.event_type}</strong>
                          <small>{traceTime(event.created_at)}</small>
                        </div>
                        <span className="trace-event-summary">
                          {event.summary || event.status}
                        </span>
                        <small className="trace-event-meta">
                          #{event.sequence}
                          {duration ? ` · ${duration}` : ""}
                        </small>
                      </div>
                    </button>
                  );
                })}
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
                  (() => {
                    const visual = traceVisual(selectedTrace);
                    const payload = tracePayload(selectedTrace);
                    const metadata = traceMetadata(selectedTrace);
                    const duration = traceDuration(selectedTrace);
                    const actionEventId = `${selectedTrace.id}:event`;
                    const actionJsonId = `${selectedTrace.id}:json`;
                    return (
                      <div className="trace-inspector">
                        <header className="trace-detail-header">
                          <div className="trace-detail-heading">
                            <p className="trace-section-kicker">
                              EVENT #{selectedTrace.sequence}
                            </p>
                            <div className="trace-detail-title-row">
                              <h2>{selectedTrace.event_type}</h2>
                              <span
                                className={`trace-status-badge trace-status-${visual.kind}`}
                              >
                                {traceStatusLabel(selectedTrace.status)}
                              </span>
                            </div>
                            <p className="trace-detail-id">
                              {selectedTrace.id}
                            </p>
                          </div>
                          <div className="trace-detail-actions">
                            <button
                              className="trace-copy-button"
                              type="button"
                              onClick={() =>
                                void copyTrace(selectedTrace, "event")
                              }
                              title="复制事件"
                            >
                              {copiedTraceAction === actionEventId ? (
                                <Check size={13} />
                              ) : (
                                <Copy size={13} />
                              )}
                              <span>Copy event</span>
                            </button>
                            <button
                              className="trace-copy-button"
                              type="button"
                              onClick={() =>
                                void copyTrace(selectedTrace, "json")
                              }
                              title="复制 JSON"
                            >
                              {copiedTraceAction === actionJsonId ? (
                                <Check size={13} />
                              ) : (
                                <Copy size={13} />
                              )}
                              <span>Copy JSON</span>
                            </button>
                          </div>
                        </header>

                        <p className="trace-detail-summary">
                          {selectedTrace.summary || "No summary provided."}
                        </p>

                        <section className="trace-inspector-section">
                          <h3>Overview</h3>
                          <dl className="trace-overview-grid">
                            <div>
                              <dt>Agent</dt>
                              <dd>
                                {traceAgentName(
                                  selectedTrace,
                                  agentsQuery.data ?? [],
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Status</dt>
                              <dd>{traceStatusLabel(selectedTrace.status)}</dd>
                            </div>
                            <div>
                              <dt>Duration</dt>
                              <dd>{duration ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Timestamp</dt>
                              <dd>{traceTime(selectedTrace.created_at)}</dd>
                            </div>
                          </dl>
                        </section>

                        <section className="trace-inspector-section">
                          <div className="trace-section-heading">
                            <h3>Payload</h3>
                            <button
                              className="trace-inline-action"
                              type="button"
                              onClick={() =>
                                void copyTrace(selectedTrace, "json")
                              }
                            >
                              {copiedTraceAction === actionJsonId
                                ? "Copied"
                                : "Copy JSON"}
                            </button>
                          </div>
                          {payload ? (
                            <pre className="trace-json-viewer">
                              {JSON.stringify(payload, null, 2)}
                            </pre>
                          ) : (
                            <p className="trace-empty-inline">
                              No payload for this event.
                            </p>
                          )}
                        </section>

                        {metadata ? (
                          <section className="trace-inspector-section">
                            <h3>Metadata</h3>
                            <pre className="trace-json-viewer">
                              {JSON.stringify(metadata, null, 2)}
                            </pre>
                          </section>
                        ) : null}
                      </div>
                    );
                  })()
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
