"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Boxes,
  Clock3,
  FolderKanban,
  LoaderCircle,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest, ApiClientError } from "@/lib/api/client";
import { shouldSubmitTextareaOnEnter } from "@/lib/forms/submit-on-enter";
import type { CreateProjectResult, ProjectSummary } from "@/lib/projects/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Mode = "engineer" | "team";
type ProjectDialog = {
  kind: "rename" | "delete";
  project: ProjectSummary;
};

function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(Math.floor(delta / 60_000), 0);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function Dashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("engineer");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialog | null>(
    null,
  );
  const [projectName, setProjectName] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiRequest<ProjectSummary[]>("/api/v1/projects"),
  });

  const createProject = useMutation({
    mutationFn: (message: string) =>
      apiRequest<CreateProjectResult>("/api/v1/projects", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          initialMessage: message,
          mode,
          scheduleStrategy: "automatic",
          agentKeys: [],
        }),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${result.projectId}`);
    },
  });

  const signOut = useMutation({
    mutationFn: async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    },
  });

  const renameProject = useMutation({
    mutationFn: ({
      project,
      name,
    }: {
      project: ProjectSummary;
      name: string;
    }) =>
      apiRequest<ProjectSummary>(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, revision: project.revision }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectDialog(null);
    },
  });

  const archiveProject = useMutation({
    mutationFn: (project: ProjectSummary) =>
      apiRequest<{ projectId: string; archived: true }>(
        `/api/v1/projects/${project.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({ revision: project.revision }),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectDialog(null);
    },
  });

  const authRequired =
    projectsQuery.error instanceof ApiClientError &&
    projectsQuery.error.code === "AUTH_REQUIRED";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || createProject.isPending) return;
    createProject.mutate(message);
  }

  function openProjectDialog(
    kind: ProjectDialog["kind"],
    project: ProjectSummary,
  ) {
    setOpenMenuId(null);
    setProjectName(project.name);
    renameProject.reset();
    archiveProject.reset();
    setProjectDialog({ kind, project });
  }

  function closeProjectDialog() {
    if (renameProject.isPending || archiveProject.isPending) return;
    setProjectDialog(null);
  }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">N</span>
          <span>Neurons</span>
        </div>
        <button
          className="new-project-button"
          onClick={() => document.getElementById("prompt")?.focus()}
        >
          <Plus size={16} /> 新项目
        </button>
        <nav className="sidebar-section" aria-label="项目导航">
          <p className="sidebar-label">工作区</p>
          <Link className="sidebar-link active" href="/dashboard">
            <Boxes size={16} /> 所有项目
          </Link>
          <div className="sidebar-label with-icon">
            <Clock3 size={13} /> 最近对话
          </div>
          <div className="recent-projects">
            {(projectsQuery.data ?? []).slice(0, 8).map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="recent-project-link"
              >
                <span>{project.name}</span>
                <small>{relativeTime(project.updatedAt)}</small>
              </Link>
            ))}
            {!projectsQuery.isLoading && projectsQuery.data?.length === 0 ? (
              <p className="sidebar-empty">还没有历史项目</p>
            ) : null}
          </div>
        </nav>
        <div className="sidebar-account">
          <span className="account-avatar">
            <UserRound size={16} />
          </span>
          <div>
            <strong>你的工作区</strong>
            <span>
              {authRequired
                ? "尚未登录"
                : projectsQuery.isSuccess
                  ? "已连接"
                  : "正在连接"}
            </span>
          </div>
          {projectsQuery.isSuccess ? (
            <button
              className="icon-button account-signout"
              aria-label="退出登录"
              title="退出登录"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              {signOut.isPending ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <LogOut size={15} />
              )}
            </button>
          ) : null}
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">BUILD SOMETHING REAL</p>
            <h1>今天想创造什么？</h1>
            <p className="muted">
              描述你的想法，Neurons 会把这段对话变成一个持续工作的项目。
            </p>
          </div>
          {authRequired ? (
            <Link className="secondary-button" href="/login">
              <LogIn size={16} /> 登录
            </Link>
          ) : null}
        </header>

        <form className="dashboard-composer" onSubmit={submit}>
          <textarea
            id="prompt"
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
            placeholder="例如：创建一个极简的旅行计划工具，可以保存地点并按日期整理……"
            aria-label="描述要创建的应用"
            rows={4}
            disabled={authRequired}
          />
          <div className="composer-footer">
            <div className="mode-switch" aria-label="执行模式">
              <button
                type="button"
                className={mode === "engineer" ? "active" : ""}
                onClick={() => setMode("engineer")}
              >
                Engineer
              </button>
              <button
                type="button"
                className={mode === "team" ? "active" : ""}
                onClick={() => setMode("team")}
              >
                Team
              </button>
            </div>
            <button
              className="send-button"
              aria-label="创建项目"
              disabled={
                !prompt.trim() || createProject.isPending || authRequired
              }
            >
              {createProject.isPending ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
          {createProject.error ? (
            <p className="inline-error">{createProject.error.message}</p>
          ) : null}
        </form>

        <section className="projects-section" aria-labelledby="projects-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR WORK</p>
              <h2 id="projects-title">项目</h2>
            </div>
            {projectsQuery.isError && !authRequired ? (
              <button
                className="text-button"
                onClick={() => projectsQuery.refetch()}
              >
                <RotateCcw size={15} /> 重试
              </button>
            ) : null}
          </div>

          {projectsQuery.isLoading ? (
            <div className="projects-state">
              <LoaderCircle className="spin" /> 正在加载项目
            </div>
          ) : null}
          {projectsQuery.isError && !authRequired ? (
            <div className="projects-state error">
              <p>项目暂时无法加载。</p>
              <small>{projectsQuery.error.message}</small>
            </div>
          ) : null}
          {authRequired ? (
            <div className="projects-state auth-required">
              <LogIn size={24} />
              <div>
                <strong>登录后开始构建</strong>
                <p>项目、对话和版本会安全地保存在你的账户中。</p>
              </div>
              <Link className="primary-button compact-button" href="/login">
                继续登录
              </Link>
            </div>
          ) : null}
          {!projectsQuery.isLoading &&
          !projectsQuery.isError &&
          projectsQuery.data?.length === 0 ? (
            <div className="projects-state empty">
              <Sparkles size={25} />
              <div>
                <strong>第一个项目从一句话开始</strong>
                <p>在上方描述想法，系统会自动创建项目并进入工作区。</p>
              </div>
            </div>
          ) : null}
          {projectsQuery.data?.length ? (
            <div className="project-grid">
              {projectsQuery.data.map((project) => (
                <article
                  key={project.id}
                  className="project-card"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setOpenMenuId((current) =>
                        current === project.id ? null : current,
                      );
                    }
                  }}
                >
                  <Link
                    href={`/projects/${project.id}`}
                    className="project-card-link"
                  >
                    <div className="project-card-top">
                      <span className="project-icon">
                        <FolderKanban size={18} />
                      </span>
                      <span
                        className={`status-dot ${project.status}`}
                        aria-label={project.status}
                      />
                    </div>
                    <div>
                      <h3>{project.name}</h3>
                      <p>
                        {project.defaultMode === "team"
                          ? "Team Mode"
                          : "Engineer Mode"}
                      </p>
                    </div>
                    <small>{relativeTime(project.updatedAt)}</small>
                  </Link>
                  <div className="project-card-menu">
                    <button
                      className="project-menu-trigger"
                      aria-label={`${project.name} 项目操作`}
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === project.id}
                      onClick={() =>
                        setOpenMenuId((current) =>
                          current === project.id ? null : project.id,
                        )
                      }
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {openMenuId === project.id ? (
                      <div className="project-menu-popover" role="menu">
                        <button
                          role="menuitem"
                          onClick={() => openProjectDialog("rename", project)}
                        >
                          <Pencil size={14} /> 重命名
                        </button>
                        <button
                          role="menuitem"
                          className="danger"
                          onClick={() => openProjectDialog("delete", project)}
                        >
                          <Trash2 size={14} /> 删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>

      {projectDialog ? (
        <div className="dialog-backdrop" onMouseDown={closeProjectDialog}>
          <section
            className="project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button dialog-close"
              aria-label="关闭"
              onClick={closeProjectDialog}
            >
              <X size={17} />
            </button>
            {projectDialog.kind === "rename" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = projectName.trim();
                  if (!name || renameProject.isPending) return;
                  renameProject.mutate({
                    project: projectDialog.project,
                    name,
                  });
                }}
              >
                <p className="eyebrow">PROJECT SETTINGS</p>
                <h2 id="project-dialog-title">重命名项目</h2>
                <label htmlFor="project-name">项目名称</label>
                <input
                  id="project-name"
                  autoFocus
                  maxLength={120}
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
                {renameProject.error ? (
                  <p className="inline-error" role="alert">
                    {renameProject.error.message}
                  </p>
                ) : null}
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closeProjectDialog}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button"
                    disabled={!projectName.trim() || renameProject.isPending}
                  >
                    {renameProject.isPending ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : null}
                    保存
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <p className="eyebrow danger-text">DANGER ZONE</p>
                <h2 id="project-dialog-title">删除项目？</h2>
                <p className="dialog-copy">
                  “{projectDialog.project.name}
                  ”将从工作区隐藏。项目数据会暂时保留，但活跃任务必须先停止。
                </p>
                {archiveProject.error ? (
                  <p className="inline-error" role="alert">
                    {archiveProject.error.message}
                  </p>
                ) : null}
                <div className="dialog-actions">
                  <button
                    className="secondary-button"
                    onClick={closeProjectDialog}
                  >
                    取消
                  </button>
                  <button
                    className="danger-button"
                    disabled={archiveProject.isPending}
                    onClick={() => archiveProject.mutate(projectDialog.project)}
                  >
                    {archiveProject.isPending ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    删除项目
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
