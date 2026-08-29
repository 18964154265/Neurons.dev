"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Boxes,
  Clock3,
  FolderKanban,
  LoaderCircle,
  LogIn,
  Plus,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest, ApiClientError } from "@/lib/api/client";
import type { CreateProjectResult, ProjectSummary } from "@/lib/projects/types";

type Mode = "engineer" | "team";

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

  const authRequired =
    projectsQuery.error instanceof ApiClientError && projectsQuery.error.code === "AUTH_REQUIRED";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || createProject.isPending) return;
    createProject.mutate(message);
  }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">N</span>
          <span>Neurons</span>
        </div>
        <button className="new-project-button" onClick={() => document.getElementById("prompt")?.focus()}>
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
              <Link key={project.id} href={`/projects/${project.id}`} className="recent-project-link">
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
            <span>{authRequired ? "尚未登录" : "已连接"}</span>
          </div>
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">BUILD SOMETHING REAL</p>
            <h1>今天想创造什么？</h1>
            <p className="muted">描述你的想法，Neurons 会把这段对话变成一个持续工作的项目。</p>
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
              disabled={!prompt.trim() || createProject.isPending || authRequired}
            >
              {createProject.isPending ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={18} />}
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
              <button className="text-button" onClick={() => projectsQuery.refetch()}>
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
          {!projectsQuery.isLoading && !projectsQuery.isError && projectsQuery.data?.length === 0 ? (
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
                <Link key={project.id} href={`/projects/${project.id}`} className="project-card">
                  <div className="project-card-top">
                    <span className="project-icon">
                      <FolderKanban size={18} />
                    </span>
                    <span className={`status-dot ${project.status}`} aria-label={project.status} />
                  </div>
                  <div>
                    <h3>{project.name}</h3>
                    <p>{project.defaultMode === "team" ? "Team Mode" : "Engineer Mode"}</p>
                  </div>
                  <small>{relativeTime(project.updatedAt)}</small>
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
