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
