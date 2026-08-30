# Developer Change Log

本文件记录用户明确要求提交的代码变更概要，帮助后续开发快速理解提交边界及系统影响。它不替代 Git 历史、PRD 或 TRD，也不得记录任何密钥和用户数据。

## 记录格式

每次提交前追加一条记录，至少包含：

- Commit：提交完成后可回填短 SHA 与标题。
- 涉及代码文件：本次提交修改的主要文件。
- 关键数据结构或方法：新增、修改或删除的核心类型、函数、接口、表或迁移。
- 上下游影响与依赖：调用方、数据流、运行环境、配置、迁移及兼容性影响。

## 变更记录

### feat(agents): define reusable team roles

- Commit：`feat(agents): define reusable team roles`
- 涉及代码文件：`lib/agents/registry.ts`、`supabase/migrations/202608300001_agent_definitions.sql`、`PRD.md`、`TRD.md`、`AGENTS.md` 及对应单元测试。
- 关键数据结构或方法：新增 Mike、Emma、Bob、Alex、David 的版本化 `AgentDefinition`，固定 Engineer Mode 使用 Alex，并建立数据库安全展示投影；同时约定每次提交前维护本文件。
- 上下游影响与依赖：服务端注册表是 Agent 行为和权限的权威来源，数据库仅提供可公开展示的描述与能力标签；运行态接入由后续 Run 提交完成，部署前需按顺序应用新迁移。

### feat(auth): add persistent password sessions

- Commit：`feat(auth): add persistent password sessions`
- 涉及代码文件：`app/login/page.tsx`、`app/reset-password/page.tsx`、`components/dashboard/dashboard.tsx`、`lib/auth/credentials.ts`、`lib/forms/submit-on-enter.ts`、`app/globals.css`、`README.md` 及对应测试。
- 关键数据结构或方法：新增 Email/Password 注册登录、密码重置、当前设备退出、认证输入校验和输入框 Enter/Shift+Enter 判定。
- 上下游影响与依赖：依赖 Supabase Auth Cookie Session、回调路由和 `proxy.ts` Token 刷新；同一 `auth.users.id` 继续通过 RLS 读取原项目，README 补充本地环境、迁移与 Auth Redirect 配置。

### fix(runs): reconcile interrupted executions

- Commit：`fix(runs): reconcile interrupted executions`
- 涉及代码文件：`app/api/v1/runs/[runId]/cancel/route.ts`、`lib/runs/cancellation.ts`、`lib/runs/worker-store.ts`、`components/workspace/project-workspace.tsx`、`supabase/migrations/202608300002_fix_run_cancel_ambiguity.sql`、`test_cases/run-cancel.json` 及对应测试。
- 关键数据结构或方法：新增 `cancelRunAndReconcile`，为 Workflow 取消设置有界等待，并保证外部取消失败后继续调用 `confirmCancelled`；`failAgentRun` 不再覆盖 `cancelling`；Run 活跃时输入框保持可编辑，取消请求失败通过 `cancelRun.error` 展示。
- 报错定位与修复：中断模型流产生 `MODEL_STREAM_INTERRUPTED` 后，`failAgentRun` 在 `jsonb_build_object` 中传入未显式定型的 `${failureCode}`，Postgres 报 `could not determine data type of parameter $4`，导致失败收口事务整体回滚、Run 长期停留在 `running`。首次修复后，真实取消 RPC 又暴露 `42702: column reference "run_id" is ambiguous`：返回参数 `run_id` 与 `ON CONFLICT (run_id, sequence)` 冲突，取消事务再次回滚。现已将动态参数显式转换为 `text`，将冲突目标改为具名唯一约束，并补齐已部署数据库的增量迁移、取消异常、超时及状态竞态收口路径。
- 上下游影响与依赖：取消 API 仍以 `request_run_cancel` 和 `confirm_run_cancelled` 为业务状态事实来源；Vercel Workflow 取消变成有界的外部清理步骤，迟到的完成、失败和流式写入均由数据库状态条件拦截。既有卡死记录不会由代码提交自动修改，需要通过已修复的取消接口单独收口。

### feat(projects): add project controls and default agents

- Commit：`feat(projects): add project controls and default agents`
- 涉及代码文件：`components/dashboard/dashboard.tsx`、`app/api/v1/projects/[projectId]/route.ts`、`lib/projects/*`、`lib/agents/scheduling.ts`、`lib/agents/presentation.ts`、`lib/chat/repository.ts`、`app/globals.css`、两条 `20260830000*` 兼容迁移及对应测试和接口用例。
- 关键数据结构或方法：新增项目重命名与软删除交互、`archiveProjectSchema`、`ProjectRepository.archive`、`latestRunId`、Engineer/Team 默认 Agent 解析和既有项目默认分配回填；取消函数改用具名唯一约束消除 PL/pgSQL 参数歧义。
- 上下游影响与依赖：Dashboard 通过项目 PATCH/DELETE API 维护项目，Project/Chat 创建链统一在服务端补齐 Alex 或 Mike；工作区 Agent 展示依赖分配回填结果。部署时需按 README 顺序应用取消修复与默认分配迁移。

### fix(runs): preserve diagnostics and stream safely

- Commit：`fix(runs): preserve diagnostics and stream safely`
- 涉及代码文件：`workflows/steps.ts`、`workflows/agent-run.ts`、`lib/runs/worker-store.ts`、`lib/runs/failure.ts`、`lib/runs/streaming.ts`、`lib/llm/errors.ts`、`lib/errors/located.ts`、`lib/agents/engineer-turn.ts` 及对应单元测试。
- 关键数据结构或方法：新增 `ModelFailure`、`LocatedErrorDetail`、脱敏诊断序列化/恢复、Provider 瞬时错误受控重试和 `shouldFlushAssistantStream`；消息 JSONB 参数显式转换为 `text`，Run 失败 Trace 持久化稳定错误码、触发位置与安全摘要。
- 上下游影响与依赖：OpenRouter、Agent Loop、Workflow 和 Postgres 写入错误不再互相误判；模型失败只重试明确的瞬时类别，内部持久化失败直接收口并可在 Trace 定位。前端错误文案和流式消息展示依赖新增的失败码与批量写入节奏。

### feat(workspace): stream markdown and recover run feedback

- Commit：`feat(workspace): stream markdown and recover run feedback`
- 涉及代码文件：`components/workspace/project-workspace.tsx`、`components/chat/markdown-message.tsx`、`package.json`、`pnpm-lock.yaml` 及 Markdown 组件测试；相关视觉规则位于前序 UI 提交的 `app/globals.css`。
- 关键数据结构或方法：新增 `MarkdownMessage`，通过 `react-markdown` 与 `remark-gfm` 安全渲染消息并显示流式光标；消息活跃期补拉、Run/Trace 确定性刷新、失败 Trace 定位及真实执行 Agent 名称展示接入工作区。
- 上下游影响与依赖：前端消费 Postgres/Realtime 持久化的增量 `messages.content.text`，Realtime 丢失时由轮询和 `lastEventSequence` 补齐；原始 HTML 不执行，外部链接使用隔离的新标签页。依赖后端稳定失败码、`latestRunId`、Agent 分配投影和流式批量写入。

### fix(workspace): keep the chat composer visible

- Commit：`fix(workspace): keep the chat composer visible`
- 涉及代码文件：`app/globals.css`。
- 关键数据结构或方法：约束 `.chat-pane` 为固定高度的三行 Grid，让 `.chat-timeline` 独立纵向滚动，并将 `.workspace-composer` 固定在 Grid 底部层级。
- 上下游影响与依赖：长对话不再扩张左侧面板或挤出输入框；桌面与移动端继续复用现有工作区结构，不涉及接口、数据结构或运行时依赖变化。

### feat(agents): run teams and stream coding changes

- Commit：`feat(agents): run teams and stream coding changes`
- 涉及代码文件：`workflows/agent-run.ts`、`workflows/steps.ts`、`lib/runs/worker-store.ts`、`lib/agents/*`、`lib/tools/workspace-files.ts`、`lib/files/project-file.ts`、`components/workspace/project-workspace.tsx`、`components/chat/markdown-message.tsx`、`app/globals.css`、`TRD.md` 及对应单元测试。
- 关键数据结构或方法：新增 `PreparedAgentRun/PreparedAgentTurn`、Team Mode 顺序执行与 `agent.handoff` Trace；将单文件写入升级为带 `coding.started` 信号的多文件原子 `coding` 工具；消息 Realtime 更新直接写入 Query Cache，并增加层级文件树、消息复制和单一 Active Agent 展示。
- 上下游影响与依赖：Engineer Mode 仍固定 Alex，用户指定 Team 严格执行所选 Agent 的注册表顺序；`coding` 继续依赖 `project_files`、Tool Invocation 和 Trace，Editor 通过 Realtime 与轮询恢复；Terminal、Sandbox 和 Preview 执行能力仍未接入。

### feat(workspace): delegate agents and preview static sites

- Commit：`feat(workspace): delegate agents and preview static sites`
- 涉及代码文件：`lib/agents/registry.ts`、`lib/tools/agent-delegation.ts`、`workflows/agent-run.ts`、`workflows/steps.ts`、`lib/runs/worker-store.ts`、`lib/preview/static-preview.ts`、`components/workspace/project-workspace.tsx`、`app/globals.css`、`TRD.md` 及对应单元测试。
- 关键数据结构或方法：新增 `delegationTargetsByAgent`、`delegate_to_*` Tool、`executeAgentDelegationTool` 与动态执行队列；新增 `buildStaticPreview`，将项目内 HTML 和相对路径 CSS/JavaScript 投影到带严格 CSP 的隔离 iframe；复制按钮改为气泡外侧定位。
- 上下游影响与依赖：Team Mode 可依照默认职责链动态追加 Agent，并分别记录 `agent.delegated` 与 `agent.handoff` Trace；用户指定调度仍限制在所选 Agent 内，Engineer Mode 运行时移除调度工具。静态 Preview 依赖 `project_files`，不执行构建且不能替代 React、Next.js 或服务端项目所需的 Vercel Sandbox。

### perf(workspace): batch streaming updates

- Commit：`perf(workspace): batch streaming updates`
- 涉及代码文件：`lib/llm/openrouter.ts`、`lib/agents/engineer-turn.ts`、`workflows/steps.ts`、`lib/runs/streaming.ts`、`lib/runs/worker-store.ts`、`components/workspace/project-workspace.tsx`、`components/chat/markdown-message.tsx`、`app/globals.css`、`TRD.md` 及对应单元测试。
- 关键数据结构或方法：新增 OpenRouter 文本事件聚合和 Tool Call 数组缓冲；调整 `shouldFlushAssistantStream` 为 250ms 最小间隔、160 字符 burst 阈值及 400ms 最大等待；`updateAssistantStream` 增加相同文本去重；Realtime 消息更新按渲染帧合并，流式阶段使用纯文本和 CSS 光标，完成后再解析 Markdown。
- 上下游影响与依赖：减少 OpenRouter 碎片事件、Postgres JSONB 更新、Supabase Realtime 广播和前端 Markdown 重算，同时继续以 `messages` 作为可恢复事实来源；Tool Call 仍只在服务端完整聚合，Workflow、Trace、断线补拉和最终消息状态协议保持兼容。

### polish(ui): de-ai visual consistency

- Commit：待提交
- 涉及代码文件：`app/globals.css`；Workspace 顶部导航的图标尺寸调整位于 `components/workspace/project-workspace.tsx`。
- 关键数据结构或方法：无；统一 UI token、控件高度、圆角、muted 文本对比度、滚动条占位及面板间距，弱化渐变、阴影、紫色装饰和卡片浮动效果。
- 上下游影响与依赖：仅影响 Dashboard、Auth、Workspace、Chat 与 Trace 的视觉呈现和键盘/滚动体验，不改变业务逻辑、API、数据结构或运行时依赖；继续复用现有浅色 semantic token，并保留弹窗/下拉层级所需的阴影。

### polish(workspace): consolidate toolbar and trace scrolling

- Commit：待提交
- 涉及代码文件：`components/workspace/project-workspace.tsx`、`app/globals.css`。
- 关键数据结构或方法：将 Canvas View Tabs、项目/版本、Publish、Follow 与 Agent 头像合并到单行 Toolbar；Tab 字号在组件实例上局部覆盖为 `16.5px`；Trace surface 增加高度约束，Trace 左栏使用独立纵向滚动。
- 上下游影响与依赖：仅改变 Workspace 顶部布局、字号和 Trace 列表滚动容器，不改变 View 切换、Agent、Publish、Follow、Trace 查询或其他业务逻辑；继续复用现有响应式断点与 semantic CSS token。

### fix(workspace): place canvas navigation in header

- Commit：待提交
- 涉及代码文件：`components/workspace/project-workspace.tsx`。
- 关键数据结构或方法：将 Canvas 导航容器改为语义化 `header`，并在四个 View Tab 实例上局部覆盖 `14px` 字号，避免受全局样式优先级影响。
- 上下游影响与依赖：仅影响 Editor、Terminal、Web Preview、Trace 四个导航按钮的层级和字体显示；不改变 View 状态、点击行为、Canvas 内容或任何后端依赖。

### fix(deploy): resolve production URLs and sandbox credentials

- Commit：`fix(deploy): resolve production URLs and sandbox credentials`
- 涉及代码文件：`app/login/page.tsx`、`lib/urls/app-url.ts`、`lib/env/server.ts`、`lib/llm/openrouter.ts`、`lib/tools/sandbox-credentials.ts`、`.env.example`、`README.md`、`supabase/config.toml` 及对应单元测试。
- 关键数据结构或方法：新增 `resolveServerAppOrigin`、`createAppUrl` 与 `resolveSandboxAccessCredentials`；注册确认、密码重置和 OpenRouter 来源 Header 统一使用经校验的应用 Origin，Vercel Sandbox 在未显式配置 Access Token 时交由 SDK 从运行上下文解析 OIDC。
- 上下游影响与依赖：生产部署不再静默回退到 localhost；Supabase Hosted Auth 仍需在 Dashboard 配置正式 Site URL 与允许的回调路径。Vercel 部署依赖 Secure Backend Access/OIDC Federation；非 OIDC 环境设置 `VERCEL_TOKEN` 时必须同时提供 Team 与 Project ID，失败不会回退到宿主机执行。

### feat(workspace): run npm apps in live previews

- Commit：`feat(workspace): run npm apps in live previews`
- 涉及代码文件：`lib/tools/terminal.ts`、`lib/tools/preview.ts`、`lib/tools/workspace-files.ts`、`lib/preview/*`、`lib/agents/registry.ts`、`components/workspace/project-workspace.tsx`、`lib/files/file-tree.ts`、`app/api/v1/projects/[projectId]/preview/route.ts`、`app/globals.css`、`TRD.md`、`test_cases/project-preview.json` 及对应单元测试。
- 关键数据结构或方法：新增 `preview_start` Tool、`PreviewStartInput`、`ProjectPreview`、`PreviewRepository.get` 与 `executePreviewStart`；复用项目持久 Sandbox 同步文件、运行 npm script、动态暴露端口并健康检查，记录 `preview.starting/ready/failed`、Terminal Session 和安全错误位置；Explorer 使用 `buildFileTreeRows` 与 `collapsedFolders` 支持目录折叠。
- 上下游影响与依赖：Alex 的动态 Web 流程变为 `coding → npm install → npm run build（存在时）→ preview_start`，Preview API 和 Realtime 将 Sandbox 状态投影到 iframe，纯静态项目仍保留隔离 `srcDoc` fallback。运行依赖 Vercel Sandbox OIDC/Access Token、现有 `sandbox_sessions`/Terminal/Trace 表和 npm 项目的可用 dev script；无需新增数据库迁移。
