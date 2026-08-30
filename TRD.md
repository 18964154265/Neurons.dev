# Neurons 技术需求文档（TRD）

> 文档状态：初稿，待评审
>
> 版本：v0.1
>
> 更新日期：2026-08-29
>
> 对应产品文档：`PRD.md` v0.1
> 适用范围：首个可用版本的架构、数据、接口、Agent 执行、运行安全、测试与部署方案

## 1. 文档目标

本 TRD 将 PRD 中的 Dashboard、项目工作区、Engineer Mode、Team Mode、Editor、Terminal、Web Preview、Trace、跟随、版本与 Publish 转化为可实施的技术边界。

本文只定义技术方案，不重新定义产品需求。首版 Agent 的数量、角色、职责和默认调度已经确认；具体模型覆盖、可执行 Tool 实现和权限组合仍通过版本化注册表逐步接入。

## 2. 已确认约束与架构决策

### 2.1 已确认技术栈

| 层级       | 技术方案                                 | 主要职责                                                |
| ---------- | ---------------------------------------- | ------------------------------------------------------- |
| Web 与 API | Next.js App Router + TypeScript + Vercel | 页面、Route Handlers、鉴权边界、API、服务端流处理       |
| 数据库     | Supabase Postgres                        | 项目、对话、版本、运行记录、Trace、幂等与事务           |
| 用户系统   | Supabase Auth + RLS                      | 登录、Cookie Session、用户数据隔离、项目权限            |
| 实时通信   | OpenAI SDK Stream + Supabase Realtime    | 服务端消费模型流；浏览器接收消息、Agent、工具和画布事件 |
| AI 调度    | OpenAI JavaScript SDK + 自有调度层       | OpenRouter 接入、模型切换、工具调用、Engineer/Team Mode |
| 持久任务   | Vercel Workflow                          | 长耗时 Agent 循环、重试、暂停、取消与部署后恢复         |
| 代码运行   | Vercel Sandbox                           | 隔离文件系统、终端命令、开发服务器和 Web Preview        |
| 文件与产物 | Supabase Storage + Sandbox Snapshot      | 用户资源、日志大对象、项目快照与版本恢复                |
| 源码托管   | GitHub App                               | 保存源码、代码审查和触发部署；不作为 P0 运行时事实来源  |
| 部署       | Vercel                                   | Neurons 主应用与用户项目发布                            |

### 2.2 对截图方案的调整

截图中的“Vercel AI SDK”被最新明确要求“采用 OpenAI SDK 连接 OpenRouter”覆盖。为避免同时维护两套模型消息、工具调用和流事件抽象，本项目采用：

- `openai` JavaScript SDK 作为唯一模型客户端。
- OpenRouter 作为 OpenAI-compatible API 网关。
- 自有 Agent Orchestrator 负责循环、调度、状态机、工具策略和事件标准化。
- Vercel Workflow 只负责耐久执行，不引入 `WorkflowAgent` 或 Vercel AI SDK 的 Agent 抽象。
- Supabase Realtime 负责浏览器实时更新，不使用 Vercel AI SDK UI Stream 协议。

若后续要重新引入 Vercel AI SDK，必须先提交 ADR，证明它不会与 OpenAI SDK 的模型调用、工具协议和运行状态重复。

### 2.3 当前仓库状态

- 仓库当前仅有约束文档和产品文档，尚未初始化 Next.js 工程。
- `.env` 已存在且已加入 `.gitignore`；TRD 和后续代码不得读取、输出、记录或提交其中的真实值。
- `/test_cases` 已加入 `.gitignore`，后端 API 实现时仍需按 `AGENTS.md` 在该目录生成本地 Mock JSON；是否将这些 Fixture 纳入版本控制待确认。
- 当前没有依赖或 lockfile，可在工程初始化时选择单一包管理器。

### 2.4 包管理与版本策略

- 使用 `pnpm`，提交 `pnpm-lock.yaml`。
- Node.js 使用 Vercel 当前支持的 LTS 运行时，并通过 `package.json#engines` 固定主版本。
- 依赖安装时固定可重复解析的版本并提交 lockfile，不在文档中硬编码易过期的具体版本号。
- 不同时引入职责重叠的 ORM、状态管理、流协议或 Agent SDK。

## 3. 范围与非目标

### 3.1 本版技术范围

- 浏览器端 Dashboard 与项目工作区。
- Supabase Auth 的 Cookie Session 和项目级 RLS。
- 从首条消息原子创建项目、主对话、消息和首次 Agent Run。
- Engineer Mode 与 Team Mode 的通用运行状态机。
- OpenAI SDK 连接 OpenRouter，支持文本流、结构化 Tool Call 和模型配置切换。
- Vercel Sandbox 中的真实文件、命令、开发服务器和 Preview。
- Editor、Terminal、Web Preview、Trace 四个 View 的统一项目状态。
- Supabase Realtime 实时事件和断线后的游标恢复。
- Snapshot、版本记录和最近成功结果保护。
- GitHub 与 Publish 的边界设计；完整交互按 PRD 后续确认逐步交付。

### 3.2 非目标

- 不支持用户创建或修改 Agent 定义。
- 不在宿主 Next.js Function 中执行生成代码或模型生成的 Shell。
- 不使用浏览器状态作为项目、Run 或 Trace 的唯一事实来源。
- 不把 Supabase Realtime 消息当作耐久事件存储。
- 不存储或展示模型私有 Chain of Thought；只存储模型明确提供的 reasoning summary、系统生成的执行摘要和工具审计信息。
- 不开发原生桌面应用或移动应用。首版只保证桌面浏览器工作区；不为移动端预留复杂响应式抽象。
- 不把 Agent 的展示能力直接当作可执行 Tool 权限；Tool 必须由服务端注册表和策略层显式授予。

## 4. 总体架构

```text
Desktop Browser
├── Next.js UI
├── Supabase Auth session
├── REST commands / history catch-up
└── Supabase Realtime private channel
            │
            ▼
Next.js on Vercel
├── Server Components: 初始读取与权限内页面渲染
├── Route Handlers: 校验、鉴权、幂等、命令受理
├── Application Services: Project / Chat / Run / Version / Publish
└── start Workflow: 快速返回 runId
            │
            ▼
Vercel Workflow
├── Agent Orchestrator
├── OpenAI SDK → OpenRouter
├── Tool Policy + Tool Registry
├── Vercel Sandbox Adapter
└── 事务写入 Message / Trace / Outbox / Version
            │
      ┌─────┴─────────────┐
      ▼                   ▼
Supabase                Vercel Sandbox
├── Auth                ├── Project filesystem
├── Postgres            ├── Command execution
├── Realtime            ├── Dev server
└── Storage             └── Snapshot / Preview URL
      │
      ▼
Realtime Dispatcher → project:{projectId} private channel → Browser

P1/P2 integrations:
GitHub App ← Version/Source Service → Vercel Deploy API
```

### 4.1 事实来源

| 数据                        | 唯一事实来源                                   | 缓存或实时副本              |
| --------------------------- | ---------------------------------------------- | --------------------------- |
| 用户身份                    | Supabase Auth                                  | SSR Cookie Session          |
| 项目、消息、Run、Agent 分配 | Postgres                                       | 浏览器 Query Cache          |
| Trace 顺序与状态            | Postgres `trace_events`                        | Realtime 事件、浏览器内存   |
| 当前工作文件                | 活跃 Sandbox 文件系统                          | Editor Buffer               |
| 耐久项目版本                | `project_versions` + Snapshot/Storage manifest | 活跃 Sandbox                |
| 最近成功预览                | `project_versions.latest_successful` 指针      | 当前 Preview iframe         |
| Agent 定义与 Tool 权限      | 服务端版本化注册表                             | Postgres 只读展示投影       |
| GitHub 源码                 | GitHub，仅在启用同步后                         | 项目版本记录中的 commit SHA |

### 4.2 核心原则

- Command 与 Event 分离：API 接受用户命令，数据库事件描述真实发生的结果。
- 先落库再广播：事件必须持久化成功后才能发给客户端。
- 至少一次执行、效果幂等：Workflow 或消息可能重试，但状态变化和 Tool Effect 不得重复。
- 前台断线不影响后台 Run；重新连接通过游标补齐。
- 任何失败都不能覆盖 `latest_successful_version_id`。
- 所有用户数据访问同时经过 API 鉴权和数据库 RLS；后台服务密钥不是跳过所有权检查的理由。

## 5. 工程结构

建议初始化后的目录如下：

```text
app/
├── (auth)/
├── (dashboard)/
├── projects/[projectId]/
├── api/
│   ├── projects/
│   ├── runs/
│   ├── agents/
│   ├── files/
│   ├── terminal/
│   ├── previews/
│   └── webhooks/
└── workflows/

components/
├── dashboard/
├── chat/
├── canvas/
│   ├── editor/
│   ├── terminal/
│   ├── preview/
│   └── trace/
└── agents/

lib/
├── auth/
├── db/
│   ├── repositories/
│   ├── transactions/
│   └── generated/
├── realtime/
├── agents/
│   ├── registry/
│   ├── orchestrator/
│   ├── scheduler/
│   └── context/
├── llm/
│   ├── openrouter-client.ts
│   ├── model-registry.ts
│   └── normalize-events.ts
├── tools/
│   ├── registry/
│   ├── policy/
│   └── executors/
├── sandbox/
├── storage/
├── versions/
├── github/
├── publish/
├── validation/
└── observability/

supabase/
├── migrations/
├── seed.sql
└── tests/

tests/
├── unit/
├── integration/
├── contract/
└── e2e/

test_cases/
└── <one JSON file per backend endpoint>
```

模块只能通过明确接口协作。UI 不直接调用 Sandbox、OpenRouter、GitHub 或后台数据库连接；Agent 不直接操作数据库表或外部 SDK。

## 6. 运行时与模块边界

### 6.1 Browser

负责：

- 页面交互和 View 状态。
- 当前项目数据的只读缓存。
- 用户输入草稿和幂等请求 ID。
- Realtime 订阅、游标记录和补拉。
- Monaco Editor、Terminal 渲染、Preview iframe 和 Trace 定位。

不得负责：

- 保存项目最终事实。
- 持有 OpenRouter、数据库或 Sandbox 密钥。
- 决定 Agent Tool 权限。
- 执行模型输出或任意代码。

### 6.2 Next.js Server

负责：

- Supabase Session 验证。
- 输入结构校验、速率限制和项目所有权检查。
- 原子创建项目、消息和 Run。
- 启动/取消 Workflow。
- 历史查询、断线补拉和签名资源访问。
- Webhook 签名验证。

常规 Route Handler 应快速返回。不得用未等待的 Promise 或普通 `setTimeout` 承载关键 Agent 工作。

### 6.3 Vercel Workflow

负责：

- Run 的耐久状态机。
- Engineer/Team 调度。
- 模型流消费和工具循环。
- Sandbox 创建、恢复、命令执行、快照与停止。
- 每一步的可重试边界与幂等检查。
- 等待用户批准或取消信号。

每个可产生外部副作用的 Workflow Step 必须带稳定 `effect_key`，在执行前查询是否已经完成。

### 6.4 Vercel Sandbox

Sandbox 是唯一允许执行生成代码和开发命令的运行时。宿主 Vercel Function 不得调用本地 Shell、`eval`、`new Function` 或子进程执行生成内容。

每个活跃项目最多绑定一个可写 Sandbox；同一项目的写操作串行化。Team Mode 可以并行推理，但对同一工作树的变更必须经项目写入锁合并。

## 7. 身份、会话与授权

### 7.1 Supabase Auth

- Next.js 使用 `@supabase/ssr` 管理 Cookie Session 和 Token 刷新。
- 首版使用 Email/Password 注册与登录；注册是否要求邮箱确认由 Supabase 项目配置决定。
- 已有 Magic Link 账户通过密码重置邮件设置密码，继续使用同一个 `auth.users.id`，不得创建平行身份或迁移项目所有权。
- Browser Client 将 Session 写入 Cookie；`proxy.ts` 在请求期间刷新过期 Access Token 并回写 Cookie。用户保持登录，直到 Refresh Session 失效、被撤销或主动退出。
- 退出登录默认只清除当前浏览器 Session，不删除账户或业务数据。
- Server Component 和 Route Handler 都必须从服务端验证用户，不信任客户端传入的 `userId`。
- Auth 相关响应不得被共享缓存；刷新 Session 的响应使用私有、不可缓存策略。

### 7.2 权限模型

P0 只支持项目 Owner：

- `projects.owner_id = auth.uid()` 才可读写。
- 所有子资源通过 `project_id` 继承项目权限。
- 用户不能读取其他项目的消息、Trace、Agent Run、Sandbox、版本和 Storage 对象。
- 后台 Workflow 使用服务端身份访问数据，但每一步仍校验 Run、Project 和 Owner 的关联完整性。

未来协作权限通过 `project_memberships` 扩展，P0 不提前实现角色矩阵。

### 7.3 RLS 规则

- 所有 `public` schema 业务表必须启用 RLS。
- `anon` 默认无业务表访问权限。
- `authenticated` 仅拥有必要的 `SELECT/INSERT/UPDATE` Grant，并受 Owner Policy 约束。
- `DELETE` 优先由服务端归档流程执行，避免客户端直接级联删除。
- 所有 View 使用 `security_invoker` 或显式撤销访问，禁止意外绕过 RLS。
- Storage bucket 为 private，通过 `storage.objects` RLS 限制到 `users/{userId}/projects/{projectId}/...`。
- Realtime 使用 private channel，并为 `realtime.messages` 设置收听策略。

RLS Policy 与 API 所有权检查必须分别测试，不能只测试其中一个。

### 7.4 数据访问 Client 分工

- Browser 和代表用户执行的 Server Component/Route Handler 使用由 `@supabase/ssr` 创建、携带用户 JWT 的 Supabase Client；这条路径必须受 RLS 约束。
- `DATABASE_URL` 只用于 Migration、事务要求较高的后台 Repository 和 Workflow，不发送到浏览器。
- 后台连接通常不具备用户 JWT 上下文，因此每个 Repository 方法必须显式接收 `ownerId + projectId`，在同一 SQL 中校验所有权，不允许先查后写形成 TOCTOU 窗口。
- 后台敏感写操作优先封装为参数化事务或受限数据库函数；函数固定 `search_path`，撤销 `public/anon/authenticated` 的直接执行权限，只授予后台数据库角色。
- `SUPABASE_SECRET_KEY` 仅用于无法通过用户 Client 或参数化数据库事务完成的 Realtime/Storage 管理操作，不作为业务 CRUD 的默认 Client。
- 禁止在同一 Repository 中隐式切换用户 Client 和后台 Client；调用点必须能看出当前权限上下文。

## 8. 数据模型

### 8.1 通用约定

- 主键使用 UUID。
- 时间使用 `timestamptz`，由数据库生成。
- 所有可变业务表包含 `created_at`、`updated_at`；需要乐观并发的表包含 `revision bigint`。
- 枚举在数据库使用受约束的 `text` 或 Postgres enum；TypeScript 使用同源生成类型。
- JSONB 只用于结构可演进的事件详情和配置快照，不替代可查询的核心列。
- 用户可见顺序使用项目或 Run 内单调递增 `sequence bigint`，不依赖时间戳排序。
- 外部 Provider ID 单独存储，不能作为内部主键。
- 软删除资源使用 `archived_at`；真正删除由异步清理流程执行。

### 8.2 核心表

#### `profiles`

| 字段           | 说明                 |
| -------------- | -------------------- |
| `id`           | 对应 `auth.users.id` |
| `display_name` | 展示名               |
| `avatar_path`  | 私有或公开头像路径   |

#### `projects`

| 字段                           | 说明                                            |
| ------------------------------ | ----------------------------------------------- |
| `id`, `owner_id`               | 项目与所有者                                    |
| `name`                         | 项目名称                                        |
| `status`                       | `ready/running/waiting/failed/stopped`          |
| `result_status`                | `none/available/published`，与当前 Run 状态分离 |
| `default_mode`                 | `engineer/team`                                 |
| `default_schedule_strategy`    | `automatic/user_selected`                       |
| `primary_conversation_id`      | 主对话                                          |
| `active_run_id`                | 当前写入 Run，可空                              |
| `current_version_id`           | 当前工作版本                                    |
| `latest_successful_version_id` | 最近成功结果，失败时不更新                      |
| `archived_at`, `revision`      | 归档和并发控制                                  |

约束：同一项目最多一个处于写执行状态的 Run。可通过部分唯一索引或事务级 Advisory Lock 保证。

#### `conversations`

- `id`, `project_id`, `owner_id`
- `kind = primary`
- `last_sequence`

P0 一个项目只有一个连续主对话；未来如 PRD 确认多会话，可新增 `kind` 与标题而不改变 Message 协议。

#### `messages`

| 字段                                  | 说明                                                      |
| ------------------------------------- | --------------------------------------------------------- |
| `id`, `project_id`, `conversation_id` | 归属                                                      |
| `run_id`, `agent_key`                 | 可空，关联执行                                            |
| `sequence`                            | 对话内稳定顺序                                            |
| `role`                                | `user/assistant/system_event`                             |
| `kind`                                | `text/thought_summary/tool_summary/status/error/approval` |
| `status`                              | `pending/streaming/completed/failed/cancelled`            |
| `content`                             | 已脱敏结构化内容                                          |
| `client_request_id`                   | 用户提交幂等键                                            |
| `completed_at`                        | 完成时间                                                  |

唯一约束：`(owner_id, client_request_id)`；流式 Assistant Message 只更新同一行，不为每个 token 新建行。

#### `agent_definitions_projection`

用于 UI 展示服务端 Agent 注册表的只读投影：

- `agent_key`, `definition_version`
- `display_name`, `description`, `avatar_path`
- `tool_labels jsonb`
- `enabled`

该表不保存权威 Prompt、密钥或 Tool 执行权限。定义只能由部署流程同步，用户无写权限。初始允许为空，待 Agent 设计完成后再添加版本化定义。

#### `project_agent_assignments`

- `project_id`, `agent_key`, `definition_version`
- `source = automatic/user_selected/system`
- `assignment_status = assigned/active/idle/completed/failed/removed`
- `assigned_run_id`, `assigned_at`, `removed_at`

头像的明亮/灰色取决于有效 assignment；运行中/等待/失败由独立状态表示。

#### `agent_runs`

| 字段                                         | 说明                      |
| -------------------------------------------- | ------------------------- |
| `id`, `project_id`, `conversation_id`        | Run 归属                  |
| `trigger_message_id`                         | 触发用户消息              |
| `mode`                                       | `engineer/team`           |
| `schedule_strategy`                          | `automatic/user_selected` |
| `status`                                     | Run 状态机                |
| `workflow_run_id`                            | Vercel Workflow ID        |
| `model_config_snapshot`                      | 模型标识和非密钥参数快照  |
| `agent_plan_snapshot`                        | 本次分配和依赖图          |
| `last_event_sequence`                        | 断线恢复游标              |
| `cancel_requested_at`                        | 取消请求                  |
| `started_at`, `completed_at`, `failure_code` | 生命周期                  |

#### `run_agent_states`

- `run_id`, `agent_key`, `definition_version`
- `status = assigned/running/waiting/completed/failed/cancelled`
- `current_step`, `started_at`, `completed_at`
- `parent_agent_key` 或 `depends_on jsonb`

#### `trace_events`

| 字段                                                     | 说明                                          |
| -------------------------------------------------------- | --------------------------------------------- |
| `id`, `project_id`, `run_id`, `agent_key`                | 归属                                          |
| `sequence`                                               | Run 内严格递增游标                            |
| `event_type`                                             | 标准事件类型                                  |
| `status`                                                 | `started/progress/completed/failed/cancelled` |
| `visibility`                                             | `user/internal`                               |
| `summary`                                                | 对话压缩节点使用的已脱敏摘要                  |
| `detail`                                                 | 用户可查看的结构化详情                        |
| `parent_event_id`, `correlation_id`                      | 关联链路                                      |
| `file_path`, `terminal_session_id`, `tool_invocation_id` | 画布定位                                      |
| `redaction_version`                                      | 脱敏规则版本                                  |

内部错误栈、Provider 原始包和安全审计详情不得放入用户可查询的 `detail`，应进入受限日志系统或 `internal` schema，并设置短保留期。

#### `tool_invocations`

- `id`, `run_id`, `agent_key`, `tool_key`, `tool_version`
- `effect_key`：幂等副作用键，唯一
- `status`, `input_redacted`, `output_redacted`
- `approval_status`
- `started_at`, `completed_at`, `duration_ms`, `error_code`

#### `project_files`

- `project_id + path` 为主键；`path` 是经过校验、最长 240 字符的项目相对路径。
- `content` 保存当前 P0 文本文件内容，单文件最大 256 KiB；二进制文件不得进入该表。
- `language`, `revision`, `checksum` 支持 Monaco 展示和后续乐观并发控制。
- `source_run_id`, `source_agent_key` 记录最近写入来源，供 Follow 定位和审计。
- 当前它是 Sandbox 接入前的持久 Workspace 文件事实来源。Phase 2 接入 Sandbox 后，必须通过 Workspace Adapter 同步，不能形成两个互相冲突的当前版本。

#### `sandbox_sessions`

- `id`, `project_id`, `provider_sandbox_id`
- `status = creating/ready/busy/hibernating/stopped/failed`
- `base_snapshot_id`, `current_snapshot_id`
- `preview_port`, `preview_url_expires_at`
- `last_activity_at`, `expires_at`

Provider ID 和 Preview URL 仅服务端可见；浏览器通过签名代理或短期授权 URL 访问。

#### `terminal_sessions` 与 `terminal_chunks`

- Session 记录 Run、Agent、命令摘要、cwd 和状态。
- Chunk 记录 `sequence`、`stream = stdout/stderr`、文本或 Storage 对象引用。
- 小输出直接入库；超过阈值的输出分块写入 Storage，数据库只存索引和已脱敏摘要。

#### `project_versions`

- `id`, `project_id`, `ordinal`, `parent_version_id`
- `source_run_id`, `status = creating/ready/failed`
- `snapshot_provider_id`, `artifact_manifest_path`
- `git_commit_sha` 可空
- `preview_status`, `validation_summary`
- `is_successful`, `created_by`

`projects.latest_successful_version_id` 只在版本快照与必要验证均成功后原子更新。

#### `artifacts`

- `id`, `project_id`, `version_id`, `kind`
- `storage_bucket`, `storage_path`, `content_type`, `size_bytes`, `checksum`
- `metadata jsonb`

#### `publications`

- `id`, `project_id`, `version_id`
- `provider`, `deployment_id`, `url`
- `status = queued/building/ready/failed/cancelled`
- `created_at`, `completed_at`, `error_summary`

#### `idempotency_records`

- `scope`, `owner_id`, `idempotency_key`
- `request_hash`, `resource_type`, `resource_id`, `response_snapshot`
- `expires_at`

同一 Key 携带不同请求内容时返回冲突，不重复执行。

#### `outbox_events`

- `id`, `project_id`, `run_id`, `sequence`, `event_type`, `payload`
- `published_at`, `attempt_count`, `next_attempt_at`

业务事务同时写入状态和 Outbox；Dispatcher 发布成功后标记。Realtime 丢失不会影响数据库恢复。

### 8.3 索引

至少建立：

- `projects(owner_id, updated_at desc)`。
- `messages(conversation_id, sequence)` 唯一。
- `agent_runs(project_id, created_at desc)`。
- `trace_events(run_id, sequence)` 唯一。
- `project_agent_assignments(project_id, removed_at)`。
- `project_versions(project_id, ordinal)` 唯一。
- `outbox_events(published_at, next_attempt_at)` 部分索引。
- 所有外键列索引。

## 9. 状态机

### 9.1 Agent Run

```text
queued → planning → running ─┬→ waiting_for_user → running
                             ├→ cancelling → cancelled
                             ├→ failed
                             └→ validating → completed
```

规则：

- 只有 Workflow 可推进执行状态；API 只能创建 Run 或写入取消/批准命令。
- 终态为 `completed/failed/cancelled`，不可回退。
- 重试创建新 Run，并通过 `retry_of_run_id` 关联；不把失败 Run 改回 running。
- `completed` 仅表示本次 Run 已按计划结束；项目是否有可用结果由版本验证决定。

### 9.2 Tool Invocation

```text
proposed → policy_check → awaiting_approval? → running → completed
                    └→ rejected             ├→ failed
                                             └→ cancelled
```

### 9.3 Sandbox

```text
absent → creating → ready ↔ busy → snapshotting → stopped
                    │         └→ hibernating → stopped
                    └→ failed
```

Sandbox 停止不等于项目丢失；必须先有可恢复 Snapshot 或已验证 Artifact Manifest。

### 9.4 Preview

```text
none → starting → ready
             └→ failed（继续指向 latest successful preview）
```

## 10. API 设计

### 10.1 通用协议

- Route Handlers 位于 `/api/v1`。
- JSON 请求和响应使用 UTF-8。
- 所有写请求必须带 `Idempotency-Key`，浏览器同时保留 `client_request_id`。
- 输入使用运行时 Schema 校验；未知字段默认拒绝。
- 错误响应统一为：

```json
{
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "用户可理解的信息",
    "retryable": false,
    "requestId": "req_...",
    "details": {}
  }
}
```

- `details` 不包含内部错误栈、SQL、Token、Prompt 或密钥。
- 分页使用不透明 Cursor，不使用大 Offset。
- 用户输入大小、消息数量、上传文件和请求频率均设置服务端上限。

### 10.2 P0 Endpoints

| Method  | Path                              | 职责                                     |
| ------- | --------------------------------- | ---------------------------------------- |
| `POST`  | `/api/v1/projects`                | 原子创建项目、主对话、首条消息和首次 Run |
| `GET`   | `/api/v1/projects`                | Dashboard 项目列表，Cursor 分页          |
| `GET`   | `/api/v1/projects/:id`            | 工作区初始数据与当前状态                 |
| `PATCH` | `/api/v1/projects/:id`            | 名称、默认模式等允许字段                 |
| `GET`   | `/api/v1/projects/:id/history`    | 消息、Run 和关键事件历史                 |
| `POST`  | `/api/v1/projects/:id/messages`   | 写消息并创建下一次 Run                   |
| `GET`   | `/api/v1/projects/:id/messages`   | 对话 Cursor 分页与断线补齐               |
| `GET`   | `/api/v1/projects/:id/agents`     | 全部 Agent 展示投影和项目分配状态        |
| `GET`   | `/api/v1/runs/:id`                | Run 当前状态                             |
| `POST`  | `/api/v1/runs/:id/cancel`         | 请求取消，不伪造立即取消成功             |
| `POST`  | `/api/v1/runs/:id/retry`          | 从失败 Run 创建新 Run                    |
| `GET`   | `/api/v1/runs/:id/events?after=`  | 按 Sequence 补拉 Trace/状态事件          |
| `GET`   | `/api/v1/runs/:id/trace/:eventId` | 获取已脱敏完整详情                       |
| `GET`   | `/api/v1/projects/:id/files`      | 当前已实现：返回持久文本文件与 revision  |
| `PUT`   | `/api/v1/projects/:id/files`      | 待实现：用户保存文件，带 baseRevision    |
| `GET`   | `/api/v1/projects/:id/terminal`   | Terminal Session 和输出补拉              |
| `GET`   | `/api/v1/projects/:id/preview`    | 当前与最近成功 Preview 信息              |
| `GET`   | `/api/v1/projects/:id/versions`   | 版本列表                                 |
| `POST`  | `/api/v1/projects/:id/publish`    | 发布指定成功版本                         |

### 10.3 原子创建项目

`POST /projects` 在一个数据库事务内完成：

1. 校验 Session、输入、模式和用户指定 Agent Key。
2. 锁定 `Idempotency-Key`。
3. 创建 Project。
4. 创建 Primary Conversation。
5. 写入首条 User Message。
6. 创建 queued Agent Run。
7. 写入 Outbox Event。
8. 提交事务。
9. 启动 Workflow，并回写 `workflow_run_id`。

如果第 9 步失败，Run 保持 `queued` 并由修复任务重新启动，不删除已经返回给用户的项目。

## 11. 实时事件协议

### 11.1 通道

- 每个项目使用 private channel：`project:{projectId}`。
- 用户订阅时使用 Supabase Auth JWT；Realtime RLS 校验项目 Owner。
- 客户端不能向系统事件 Channel 广播可信事件。
- Realtime 只是低延迟传输，数据库事件表才可补拉和审计。

### 11.2 事件 Envelope

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "projectId": "uuid",
  "runId": "uuid",
  "sequence": 42,
  "type": "tool.completed",
  "timestamp": "2026-08-29T10:00:00Z",
  "agentKey": "agent-key-or-null",
  "correlationId": "uuid",
  "payload": {}
}
```

客户端必须按 `sequence` 去重和排序。检测到缺口时暂停应用后续状态，调用 `GET /runs/:id/events?after=<lastSequence>` 补齐，再继续消费。

### 11.3 P0 事件类型

- `run.queued/planning/started/waiting/completed/failed/cancelled`
- `agent.assigned/started/status/completed/failed`
- `message.started/delta/completed/failed`
- `thought.summary`
- `tool.proposed/approval_required/started/progress/completed/failed`
- `file.opened/changed/saved`
- `terminal.started/output/completed/failed`
- `preview.starting/ready/failed`
- `version.creating/ready/failed`
- `follow.target_changed`

### 11.4 流量控制

- 模型 Token 不逐 token 落库或广播；服务端按时间或字节窗口合并为 Delta。
- Terminal Output 按行数/字节聚合，并设置单事件大小上限。
- Realtime 事件只携带 UI 必需内容；大详情通过 REST 或签名 Storage URL 获取。
- Message 完成时写入最终文本，断线恢复不依赖所有 Delta 都存在。

## 12. OpenRouter 与模型层

### 12.1 环境约定

两个核心 Secret：

- `DATABASE_URL`：Supabase Postgres 服务端连接字符串。
- `OPENROUTER_API_KEY`：OpenRouter API Key。

OpenRouter Base URL 使用非密钥配置 `OPENROUTER_BASE_URL`，默认 `https://openrouter.ai/api/v1`。模型 ID 使用 `OPENROUTER_DEFAULT_MODEL` 或 Agent/Run 配置，不把模型名写死在业务组件中。

### 12.2 Client 封装

服务端创建单一 Client Factory：

```ts
new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: env.OPENROUTER_BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": env.APP_URL,
    "X-OpenRouter-Title": "Neurons",
  },
});
```

- Client 仅存在于 Server/Workflow 模块。
- P0 使用 OpenRouter 明确兼容的 `chat.completions.create({ stream: true })` 路径。
- 在未通过兼容性 Contract Test 前，不依赖特定 Provider 独有的 Responses API Event。
- Provider Stream 必须先归一化为 Neurons 内部事件，UI 不直接依赖 OpenAI/OpenRouter Response Shape。
- 保存实际 Provider、Model、请求 ID、Token Usage、Latency 和 Finish Reason，但不记录 API Key。

### 12.3 模型注册

模型配置由服务端 `ModelRegistry` 管理：

- `model_key`：内部稳定键。
- `openrouter_model_id`：可替换 Provider ID。
- 能力：tool calling、structured output、reasoning summary、context window 等。
- 允许的 Agent Keys。
- 超时、最大输出、最大工具轮次和成本预算。
- 启用状态与配置版本。

Agent 定义引用 `model_key`，Run 保存解析后的配置快照。模型切换不修改历史 Run。

### 12.4 模型错误分类

至少归一化：

- `MODEL_AUTH_FAILED`
- `MODEL_RATE_LIMITED`
- `MODEL_TIMEOUT`
- `MODEL_CONTEXT_EXCEEDED`
- `MODEL_UNAVAILABLE`
- `MODEL_INVALID_TOOL_CALL`
- `MODEL_STREAM_INTERRUPTED`
- `MODEL_POLICY_BLOCKED`

只对明确的瞬时错误重试，并使用指数退避与抖动。认证、无效输入、策略拒绝不自动重试。

## 13. Agent 架构

### 13.1 Agent Definition

Agent 定义在服务端版本化注册表中，当前接口为：

```ts
type AgentDefinition = {
  key: string;
  version: number;
  displayName: string;
  role: string;
  description: string;
  goals: string[];
  capabilities: string[];
  outputFocus: string[];
  boundaries: string[];
  handoffs: Partial<Record<AgentKey, string>>;
  toolLabels: string[];
  instructions: string;
  model?: string;
  tools: LLMTool[];
};
```

- 权威定义位于服务端 `lib/agents/registry.ts`，固定包含 Mike、Emma、Bob、Alex 和 David；浏览器只能读取安全展示投影。
- Prompt 正文和 Tool 权限不从浏览器或可写数据库字段加载。
- 迁移 `202608300001_agent_definitions.sql` 将名称、描述和能力标签同步到 `agent_definitions_projection`；这些标签不授予执行权限。
- 已运行任务始终引用具体 `key + version`，定义升级不改变历史。

首版稳定 Agent Key 为：`mike`、`emma`、`bob`、`alex`、`david`。Engineer Mode 固定解析 `alex`；Team Mode 固定由 `mike` 负责调度。默认调度阶段定义在 `defaultScheduleRules`，用户指定模式只允许使用请求中的 Agent Key。

#### 13.1.1 配置层级与当前接入状态

- `capabilities` 是调度和职责描述，不直接授予权限。
- `toolLabels` 是安全的 UI 展示文案，不代表工具已经可以执行。
- `tools` 才是发送给模型的可执行 Tool Allowlist；调用还必须通过服务端 Tool Executor 的名称、Schema、项目范围和副作用检查。
- 五个 Agent 当前均使用定义版本 `1`，未设置 Agent 级 `model`，因此统一继承 `OPENROUTER_DEFAULT_MODEL`。
- 当前持久 Workflow 只实现 Engineer Mode 的 Alex。Team Mode 的角色、默认任务图和投影已经定义，但多 Agent Scheduler/Executor 尚未接入；执行器会以 `TEAM_MODE_NOT_CONFIGURED` 安全失败，不得把展示配置描述为已经执行。
- 当前 Tool Loop 最多 8 个模型回合；每次模型调用只对明确的瞬时 Provider 错误重试 3 次。单个 Workspace 文本文件最大 256 KiB，路径必须是项目根目录下的规范相对路径。

#### 13.1.2 Mike — Team Lead（`mike@1`）

- 描述：理解用户目标，拆分任务并协调团队交付。
- 核心目标：判断任务规模和领域；生成最小任务图；选择 Agent；管理依赖、顺序、失败重试和汇总；向用户解释当前负责人和原因。
- 能力标识：`project_context`、`agent_orchestration`、`workflow_state`、`result_synthesis`、`user_decision`。
- 输出重点：任务图、Agent 分工、依赖与顺序、执行状态、最终汇总。
- 行为边界：默认不写业务代码；不和专业 Agent 重复执行；不创建新 Agent；严格尊重用户指定 Agent；并行任务不得发生文件写冲突。
- 固定交接：需求不清楚 → Emma；架构或数据库 → Bob；功能或 Bug → Alex；测试、数据验证或验收 → David。
- 展示工具标签：项目上下文读取、Agent 分配和取消、工作流状态管理、结果汇总、请求关键决策。
- 当前可执行工具：无；Team Mode Executor 尚未接入。

#### 13.1.3 Emma — Product & Research（`emma@1`）

- 描述：把模糊想法整理成清晰、可实现、可验收的产品需求。
- 核心目标：理解用户、场景和目标；梳理范围、流程与验收标准；按需研究；负责界面文案、基础内容策略和基础 SEO。
- 能力标识：`web_research`、`project_docs`、`product_requirements`、`preview_review`、`product_ux`。
- 输出重点：用户目标、功能范围、用户流程、验收标准、待确认问题、给 Bob 或 Alex 的交接摘要。
- 行为边界：不决定底层架构；默认不改业务代码；不把未验证研究结论当事实；不擅自扩大范围。
- 展示工具标签：Web Research、项目文档读取、PRD 和用户故事、Preview 页面观察、产品与 UX 分析。
- 当前可执行工具：无；Research、文档与 Preview Tool 尚未接入。

#### 13.1.4 Bob — System Architect（`bob@1`）

- 描述：将产品需求转换成安全、清晰、可实现的技术方案。
- 核心目标：设计前后端边界、数据模型和接口；规划 Agent、事件、Trace、Sandbox；识别安全、权限、性能和一致性风险；为 Alex 提供适度方案。
- 能力标识：`repository_analysis`、`database_design`、`api_events`、`auth_rls`、`technical_research`、`architecture_risk`。
- 输出重点：技术决策、模块边界、数据结构、API/事件契约、安全要求、实现顺序。
- 行为边界：不过度设计；默认不承担大量业务实现；不绕过安全或审批；决策必须追溯到需求。
- 展示工具标签：代码库与依赖分析、数据库 Schema 设计、API 与事件协议设计、Auth/RLS 检查、技术文档检索、架构风险分析。
- 当前可执行工具：无；只读 Repository、Schema 和技术检索 Tool 尚未接入。

#### 13.1.5 Alex — Full-stack Engineer（`alex@1`）

- 描述：负责真正编写、运行、修复和交付应用。
- 核心目标：按需求和架构实现；操作文件、终端和 Preview；修复 Bug 并保持项目可运行；在 Engineer Mode 独立完成理解、实现、验证和汇报。
- 能力标识：`file_operations`、`terminal`、`browser_preview`、`fullstack`、`supabase`、`testing_build`、`deployment_preparation`。
- 输出重点：实现结果、文件变更、验证证据、风险、未完成项。
- 行为边界：默认是生产代码唯一主要写入者；不输出密钥；不伪造验证；危险操作、生产迁移和 Publish 需审批；遇到需求/架构矛盾时暂停；Engineer Mode 不隐式调用其他 Agent。
- 展示工具标签：文件读写、Terminal、浏览器与 Web Preview、前后端开发、Supabase、测试与构建、部署准备。
- 当前可执行工具：`workspace_list_files`、`workspace_read_file`、`workspace_write_file`。写入持久化到 `project_files`，生成 `tool_invocations` 与 `file.saved` Trace，并由 Editor 实时/轮询展示。
- 尚未接入：Sandbox 文件系统同步、Patch/Diff、Terminal、Preview、Validation、Supabase 管理、部署与 Publish Tool。因此 Alex 不能声称已经运行、构建、预览或部署仅写入 Editor 的文件。

#### 13.1.6 David — Quality & Data Engineer（`david@1`）

- 描述：用测试和证据判断产品是否真正可用。
- 核心目标：按验收标准验证；检查数据库、权限、持久化和异常；执行类型/自动化/用户流程检查；分析 Trace 与日志；向 Alex 提供可复现缺陷。
- 能力标识：`playwright`、`automated_testing`、`typecheck_build`、`database_readonly`、`trace_logs`、`preview_acceptance`。
- 输出重点：验证范围、通过项、失败项、复现步骤、证据、风险和发布建议。
- 行为边界：不把页面打开当作完成；不改生产数据；默认不重写业务实现；只有明确分配时补测试代码；无法验证必须标记。
- 展示工具标签：Playwright、单元与集成测试、类型检查和构建、数据库只读检查、Trace/日志分析、Preview 验收。
- 当前可执行工具：无；Validation、数据库只读、Trace 和 Preview Tool 尚未接入。

### 13.2 Engineer Mode

- Scheduler 固定解析 Alex，不在后台隐式调用其他 Agent。
- 一个 Run 只有一个主 Agent State。
- Agent Loop：构建上下文 → 请求模型流 → 解析 Tool Call → Policy → 执行 Tool → 写回 Tool Result → 继续，直到完成或达到限制。
- 单 Agent 不代表单次模型调用；允许多轮工具循环，但有明确上限。

### 13.3 Team Mode

Team Mode 分为：

1. 自动调度：Scheduler 根据任务和 Agent Capability 产生有向无环执行计划。
2. 用户指定：只从请求中的 Agent Keys 构建计划；能力不足时进入 `waiting_for_user`，不得静默添加 Agent。

Team Plan 至少包含：

- 参与 Agent 与定义版本。
- 每个 Agent 的目标和交付物。
- 依赖关系。
- 可并行的只读步骤。
- 需要串行写工作树的步骤。
- 终止条件和汇总 Agent。

P0 的并发原则：模型推理和只读工具可并行；同一 Project Workspace 的写文件、命令和快照通过单写者锁串行执行，避免 Agent 相互覆盖。

### 13.4 上下文构建

每次模型调用只由 Context Builder 组装：

- 版本化 System Instruction。
- Agent Definition 和当前任务目标。
- 与当前任务相关的对话窗口及摘要。
- 当前项目版本、文件树和必要文件片段。
- 已完成 Tool Result 与失败信息。
- 安全策略和可用 Tool Schema。

不得把全部历史、全部 Terminal Log 或全部 Trace 无限制塞入上下文。Context Builder 记录选取依据、Token 估算和截断结果，不记录敏感原文到公开 Trace。

### 13.5 Thought 与 Trace

- 对话中的 Thought 是系统生成或 Provider 明确提供的简短 reasoning summary。
- Trace 详情展示任务解释、决策摘要、Tool 输入输出、文件 Diff、命令和错误。
- 不请求、保存或展示私有 Chain of Thought 原文。
- Provider 返回的 reasoning 字段必须经过能力判断和脱敏后再决定是否保存。

## 14. Tool 系统

### 14.1 Tool Registry

每个 Tool 必须声明：

- 稳定 `tool_key` 与版本。
- 用户可读描述。
- 严格输入/输出 Schema。
- 风险等级：`read/write/execute/network/publish/destructive`。
- 所需 Sandbox、网络、项目权限和审批策略。
- 超时、最大输出和是否可重试。
- 幂等策略和审计字段。

### 14.2 P0 Tool 类别

- Workspace：列目录、读文件、搜索、写文件、应用 Patch、读取 Diff。
- Terminal：以 argv 形式运行批准命令、读取进程状态、停止进程。
- Preview：启动/停止 Dev Server、健康检查、获取 Preview URL。
- Version：创建 Snapshot、生成 Manifest、恢复指定版本。
- Validation：运行 lint、typecheck、test、build。

GitHub、Publish、外部网络工具按 P1/P2 与产品范围启用。

### 14.3 Tool Policy

- 模型 Tool Call 永远是提议，不是直接执行指令。
- Tool Key 必须同时存在于全局注册表和当前 Agent 的 Allowlist。
- 输入在执行前进行 Schema、路径、大小、权限和策略校验。
- 文件路径规范化后必须位于 Sandbox Workspace Root；拒绝绝对路径、`..` 逃逸和符号链接逃逸。
- 命令使用 executable + argv，不拼接未转义 Shell 字符串。
- 安装依赖只允许经过策略批准的 Registry、包名和版本；模型不能自行安装任意依赖。
- 网络默认拒绝，仅对批准域名、协议和端口开放。
- Publish、覆盖版本、删除资源等高风险操作要求明确用户审批。
- 输出先截断和脱敏，再进入模型上下文、Trace 或 Realtime。

### 14.4 幂等和副作用

每个 Tool Invocation 生成稳定 `effect_key = hash(runId, agentKey, stepId, toolKey, normalizedInput)`。

- 已完成的相同 Effect 直接返回保存结果。
- 进行中的 Effect 不能并行重复执行。
- 不可安全重试的命令在未知结果时进入 `waiting_for_user` 或人工恢复，不盲目重放。

## 15. Sandbox、Editor、Terminal 与 Preview

### 15.1 Sandbox 生命周期

1. 新项目从批准的基础 Snapshot 创建 Sandbox。
2. 每次恢复校验 Snapshot 与项目 Version 的关联。
3. Agent Run 取得项目写锁后才能修改文件或执行影响工作区的命令。
4. 活动期间刷新 `last_activity_at`。
5. 空闲后由耐久 Workflow 创建 Snapshot 并停止 Sandbox。
6. Snapshot 失败时不销毁唯一活跃工作副本；先上报告警并重试受限次数。

Snapshot 有 Provider 生命周期限制，因此不能单独作为永久版本。每个成功 Version 还需保存 Artifact Manifest；重要源文件按策略归档到 Storage 或 GitHub。

### 15.2 文件同步与 Editor

- Editor 使用 Monaco Editor，提供 VS Code 风格文件树、标签页、语言服务和 Diff。
- Sandbox 文件系统是活跃文件事实来源。
- 文件读取返回 `content + revision/checksum`。
- 用户保存时提交 `baseRevision`，不匹配返回 `409 FILE_CONFLICT` 和最新 Diff。
- Agent 写文件同样走 Workspace Tool 和 Revision Check，不直接调用 Provider SDK。
- Agent 文件事件包含 `path`、操作类型、Diff 摘要和 Trace Event ID，供跟随定位。
- 二进制文件不在 Monaco 中编辑，通过 Artifact Viewer 或下载处理。

### 15.3 Terminal

- P0 Terminal 首先是 Agent 命令与真实输出的可恢复 Viewer。
- 使用 xterm.js 渲染，但后台不依赖一条永久 WebSocket/PTY 连接。
- Agent 命令通过 Sandbox Command Tool 启动，stdout/stderr 聚合为 Terminal Events。
- 刷新后按 Session 和 Chunk Sequence 补拉。
- 用户直接交互式 PTY 输入在 PRD 确认前不开放；若后续开放，需要独立低延迟通道、输入权限和 Shell 审批模型。

### 15.4 Web Preview

- Preview Dev Server 只在 Sandbox 内运行。
- 系统检测启动端口和健康状态，返回受控访问 URL。
- iframe 使用严格 `sandbox` 属性、独立 Origin 和 CSP，避免用户项目访问 Neurons 主站 Cookie 或 DOM。
- Preview URL 短期有效，不写入聊天正文或公开日志。
- 记录 `project_version_id`，UI 同时显示当前尝试与最近成功版本。
- 当前启动失败时保留最近成功 Preview 指针。

### 15.5 跟随协议

跟随是浏览器本地偏好，默认 `enabled`，不参与项目业务状态。

- `file.opened/changed` → Editor View + path/range。
- `terminal.started/output` → Terminal View + session/sequence。
- `preview.ready` → 可提示但不强制切换，除非产品规则确认。
- `thought.summary/tool.*` → Chat 更新；点击详情显式切到 Trace。

当用户手动切换 View 或滚动时，浏览器把 Follow 置为 `temporarily_suspended`，保留最新目标并显示“回到最新操作”。具体恢复时机待 PRD 确认，协议不写死为单一按钮逻辑。

## 16. 版本、Storage 与恢复

### 16.1 版本创建

Run 在关键阶段创建候选版本：

1. 停止工作区写入或取得一致性锁。
2. 生成文件 Manifest：路径、大小、Checksum、可执行/二进制标记。
3. 创建 Sandbox Snapshot。
4. 保存必要 Artifact 到 private Storage。
5. 运行规定的 Validation。
6. 写入 `project_versions`。
7. 成功后原子更新 Project 指针。

### 16.2 最近成功结果保护

- 进行中工作写入 Candidate Version，不覆盖 Stable Version。
- Lint/Test/Build 的通过集合由项目模板策略定义。
- 失败 Candidate 可保留用于诊断，但 `is_successful = false`。
- Preview 默认展示当前 Candidate；Candidate 不可用时自动展示并标记最近 Stable，而不是伪装当前尝试成功。

### 16.3 Storage 结构

```text
users/{userId}/projects/{projectId}/
├── uploads/
├── versions/{versionId}/manifest.json
├── versions/{versionId}/artifacts/...
├── terminal/{sessionId}/...
└── trace/{runId}/...
```

- Bucket 默认为 private。
- 文件上传必须校验 MIME、扩展名、大小和病毒/恶意内容策略。
- Signed URL 设置短有效期。
- 删除项目时先标记，再由异步清理数据库、Storage、Sandbox、GitHub/Deployment 关联。

## 17. GitHub 与 Publish

### 17.1 GitHub

- 使用 GitHub App，不使用用户长期 PAT。
- 请求最小 Repository Permissions；默认只访问用户明确授权的仓库。
- Installation Token 仅服务端短期使用，不持久化明文。
- Webhook 必须校验签名并幂等处理。
- GitHub 同步失败不损坏 Neurons 内部版本；版本记录保存同步状态与 Commit SHA。
- P0 可以先不启用 GitHub，内部版本机制不得依赖它才能运行。

### 17.2 Publish

- 只允许发布 `is_successful = true` 的 Version。
- Publish API 创建 Publication Record 后启动耐久部署流程。
- Deployment 状态通过已验证 Webhook 或 Provider 查询更新。
- 发布失败保留现有线上版本。
- 域名、可见性、回滚与撤回规则待 PRD 确认后补充。

## 18. 安全设计

### 18.1 信任边界

以下均视为不可信：

- 用户输入和上传。
- 模型文本、Tool Call、文件名和命令。
- Sandbox 输出和用户项目网页。
- GitHub 内容和 Webhook Payload。
- Realtime 客户端事件。
- 数据库中历史保存的外部内容。

### 18.2 Secret

- Secret 只放在 Vercel Environment Variables 或批准的 Secret Store。
- `OPENROUTER_API_KEY`、`DATABASE_URL`、Supabase Secret Key、GitHub Private Key 不得使用 `NEXT_PUBLIC_` 前缀。
- `.env`、环境变量对象和请求 Header 不进入日志、Trace、Prompt 或 Sandbox。
- Sandbox 只注入用户项目实际需要且明确批准的短期、最小权限 Secret；P0 默认不注入宿主 Secret。
- 日志脱敏覆盖常见 Token、连接串、Authorization Header 和 URL Credential。

### 18.3 Prompt Injection 与 Tool Abuse

- System Instruction 明确区分用户需求、仓库文档和外部内容，不把外部文本当系统指令。
- Tool Policy 在模型之外强制执行；Prompt 不是安全边界。
- 读取到的网页、README、代码注释和终端输出不能扩大 Agent 权限。
- 高风险副作用需要结构化审批，审批绑定具体 Tool、输入 Hash 和过期时间。

### 18.4 Sandbox 网络与资源

- 网络默认拒绝，按任务开放批准目的地。
- 限制 CPU、内存、磁盘、文件数、进程数、端口、运行时间和输出大小。
- 命令超时后先终止子进程树，再更新失败状态。
- 禁止访问云 Metadata、内网、宿主服务和其他项目 Sandbox。
- 基础 Snapshot 来自受控模板，生成后记录 Hash。

### 18.5 Web 安全

- 使用 CSP、CSRF 防护、Secure/HttpOnly/SameSite Cookie。
- 对所有写 API 验证 Origin/CSRF Token。
- Preview 与主站不同 Origin。
- 用户内容按纯文本或安全 Markdown 渲染；禁止未清洗 HTML。
- 下载使用安全 Content-Disposition 和 MIME。
- 错误响应不暴露堆栈与内部资源 ID。

## 19. 可靠性、并发与恢复

### 19.1 幂等

- Project 创建、Message 发送、Run 启动、Tool Effect、Snapshot、GitHub Push 和 Publish 都有独立幂等键。
- Workflow Step 可重复进入，但同一 Effect 只产生一次外部副作用。
- Outbox Dispatcher 至少一次投递，客户端按 Event ID/Sequence 去重。

### 19.2 项目写锁

- 一个项目最多一个写 Run。
- 新消息在已有写 Run 时默认进入队列；“插话、中断或并行”的产品规则确认前不并发写工作树。
- Team Agent 使用 Run 内调度锁，不绕过项目级单写者约束。
- 用户和 Agent 同时保存同一文件时使用 Revision 冲突，不做静默 last-write-wins。

### 19.3 取消

- Cancel API 只记录 `cancel_requested_at` 并发出控制信号。
- Workflow 在模型流片段、Tool 前后和长命令心跳处检查取消。
- UI 先显示 `cancelling`，只有 Workflow 确认资源清理后显示 `cancelled`。
- 已完成的文件改动和命令效果不会伪装回滚；取消总结列出已完成与未完成项。

### 19.4 恢复

- 浏览器刷新：REST 获取 Project Snapshot → 订阅 Realtime → 按 Sequence 补拉缺口。
- Realtime 断线：指数退避重连，恢复后补拉。
- Workflow 中断：从完成 Step 恢复，Tool Effect 查重。
- Sandbox 丢失：从 Project Version Snapshot/Artifact 重建。
- 模型流中断：保留已接收摘要；如果 Provider 不支持安全续传，创建新模型调用并明确记录重试，不拼接成伪完整响应。
- 部署更新：运行中的 Workflow 使用其已绑定版本完成；新 Run 使用新定义版本。

## 20. 性能与容量基线

这些是首版工程目标，需在压测后修订：

- Dashboard 首屏服务端响应 P95 小于 1.5 秒，不含用户网络与冷启动异常。
- 普通 API P95 小于 800 毫秒；创建 Run 在 2 秒内返回已受理状态，不等待模型完成。
- 事件持久化到浏览器可见的 P95 小于 1 秒。
- Realtime 重连后 3 秒内开始补拉缺口。
- 单 Message 最终文本、单 Trace Detail、单 Terminal Chunk 和单上传文件均设置明确上限；具体数值在实现前通过产品和成本预算确认。
- 大日志、二进制和版本 Artifact 不写入数据库大字段。
- 数据库查询避免 N+1；Dashboard、History、Trace 均 Cursor 分页。
- OpenRouter 和 Sandbox 并发按用户、项目和全局三层限流。

### 20.1 P0 默认硬限制

以下限制在实现时必须集中配置并由服务端强制执行。后续可以根据压测和套餐下调或上调，但不得删除边界：

| 资源                          | P0 默认上限                                 |
| ----------------------------- | ------------------------------------------- |
| 普通 JSON Request Body        | 1 MiB                                       |
| 单条用户消息                  | 32 KiB UTF-8                                |
| 单个文本文件 Editor 读取/保存 | 2 MiB                                       |
| 单文件上传                    | 20 MiB                                      |
| 单项目 Sandbox Workspace      | 512 MiB、20,000 个文件                      |
| 规范化相对路径                | 240 字符、最大 32 层                        |
| 单 Tool 输入                  | 256 KiB；超过则拒绝或改用 Artifact 引用     |
| 单 Tool 用户可见输出          | 64 KiB；完整大对象进入 private Storage      |
| 单 Realtime Event             | 32 KiB                                      |
| 单 Terminal Chunk             | 16 KiB                                      |
| 单 Run Terminal 原始输出      | 20 MiB，之后停止命令并报告超限              |
| 普通命令默认/最大执行时间     | 2 分钟 / 10 分钟                            |
| Sandbox 无活动休眠时间        | 5 分钟                                      |
| 单 Run 活跃执行时间           | 60 分钟；等待用户时间不计入但有独立过期策略 |
| 单 Run 模型调用次数           | 40                                          |
| 单 Run Tool Call 次数         | 100                                         |
| 单 Tool/Provider 瞬时失败重试 | 最多 3 次                                   |
| 单 Run 模型输出总量           | 64,000 tokens，且不得超过具体模型限制       |

- Agent Definition 可以设置更低的限制，不能超过平台硬限制。
- 依赖安装、Build 和 Dev Server 可以申请更长命令时间，但必须由已登记 Tool Policy 明确授予，不能由模型输入覆盖。
- 用户级和全局并发/Token/成本配额在上线前依据 Vercel、Supabase 与 OpenRouter 套餐补充；缺少套餐数据时采用安全关闭而不是无限制运行。

## 21. 可观测性与成本

### 21.1 Correlation

每个请求、Run、Workflow、Agent、Tool、Sandbox Command、Model Call 和 Publication 都关联：

- `request_id`
- `project_id`
- `run_id`
- `correlation_id`
- `user_id_hash`，日志不得存原始身份信息

### 21.2 指标

- API 延迟、错误率和幂等命中率。
- Run 排队时间、成功率、取消率和恢复次数。
- 模型首 Token、总延迟、Token、成本、Provider/Model 错误。
- Tool 成功率、审批率、超时和重试。
- Sandbox 创建/恢复时间、活跃时长、Snapshot 成功率和 Preview 启动时间。
- Realtime 延迟、断线和补拉缺口数量。
- Version Validation 与 Publish 成功率。

### 21.3 日志与保留

- 结构化日志不记录 Prompt 全文、模型全文、文件全文、连接串和 Token。
- 用户可见 Trace 与内部日志分离。
- 大输出进入受限 Storage 并设置生命周期。
- 保留期、审计要求和用户删除 SLA 待合规需求确认。

### 21.4 成本保护

- 每 Run 限制最大模型轮次、Tool Call、Token、Sandbox 时长和重试次数。
- 超过软预算时发出事件，超过硬预算时进入 `waiting_for_user` 或失败。
- Sandbox 空闲后耐久休眠并 Snapshot，禁止依赖内存 Timer。
- 模型和 Agent 配置支持按能力路由，具体策略待角色设计后确定。

## 22. 环境变量契约

用户目前明确的两个核心 Secret 是 `DATABASE_URL` 和 `OPENROUTER_API_KEY`。完整实现 Supabase Auth、Realtime、Storage、Sandbox、GitHub 与 Publish 还需要下列配置；它们不是对当前 `.env` 的读取结果，而是部署前置条件。

### 22.1 P0 Required

| 变量                                   | 暴露范围                 | 说明                                                    |
| -------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `DATABASE_URL`                         | Server only / Secret     | Supabase Postgres 连接串，使用适合 Serverless 的 Pooler |
| `OPENROUTER_API_KEY`                   | Server only / Secret     | OpenRouter API Key                                      |
| `OPENROUTER_BASE_URL`                  | Server only / Non-secret | 默认 `https://openrouter.ai/api/v1`                     |
| `OPENROUTER_DEFAULT_MODEL`             | Server only / Non-secret | 待模型设计后填写                                        |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser allowed          | Supabase Project URL                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser allowed          | Supabase Publishable Key，不是 Secret Key               |
| `SUPABASE_SECRET_KEY`                  | Server only / Secret     | 后台 Realtime/Storage/管理操作；仅在确有需要时使用      |
| `APP_URL`                              | Server + Browser safe    | Neurons 主站 URL                                        |
| `VERCEL_OIDC_TOKEN`                    | Server only / Secret     | Vercel 部署自动提供；本地开发通过 Vercel Link/Pull 获取 |

### 22.2 P1/P2

- GitHub App ID、Client ID、Private Key、Webhook Secret。
- Vercel Publish 所需项目/团队标识与授权。
- 可观测性 Exporter 配置。

### 22.3 校验

- 使用单一 `env` 模块在进程启动时校验变量。
- Server 与 Client Schema 分开，Client Bundle 只能访问允许公开的变量。
- 提供 `.env.example`，只放名称和占位符，不复制真实 `.env`。
- 测试环境使用独立项目与最小权限凭据。

## 23. 测试策略

### 23.1 测试层级

- Unit：状态机、Scheduler、Context Builder、Event Normalizer、Tool Policy、Path Guard、Redactor。
- Integration：Route Handler + Postgres、RLS、Storage Policy、Outbox、Workflow Step 幂等、Sandbox Adapter。
- Contract：OpenRouter OpenAI-compatible Stream/Tool Call、Supabase Realtime Event、Vercel Sandbox 与 GitHub Webhook。
- E2E：登录 → 创建项目 → Run → 文件修改 → Preview → Trace → 刷新恢复 → 失败后保留 Stable Version。
- Security：跨用户访问、RLS 绕过、路径逃逸、命令注入、Prompt Injection、Secret 泄漏和 Preview Origin 隔离。

### 23.2 模型与 Sandbox 测试替身

- 定义 `LLMClient` 和 `SandboxProvider` 接口。
- 自动化测试使用确定性 Fixture Stream，不调用付费或不稳定模型。
- Fixture 覆盖文本 Delta、多个 Tool Call、Malformed Args、流中断、Rate Limit 和取消。
- Sandbox Fake 只用于测试；生产启动时如果 Provider 配置缺失应明确失败，不能退化为 Mock 成功。

### 23.3 API Mock 文件

每个后端 Endpoint 创建一个 `/test_cases/*.json`。每条 Case 的第一个键必须是测试描述，后续键为 Request、Auth Context、Expected Response 和 Expected Side Effects，例如：

```json
[
  {
    "description": "已登录用户使用幂等键成功创建项目",
    "request": {},
    "auth": {},
    "expected": {},
    "sideEffects": []
  }
]
```

每个 Endpoint 至少包含成功、失败、无权限、边界、重复请求和恢复路径。

### 23.4 数据库测试

- Migration 从空库可重复执行。
- RLS 使用两个不同用户验证互相不可见。
- 后台写入验证项目归属和外键完整性。
- Outbox 与业务状态同事务。
- `latest_successful_version_id` 在失败流程中保持不变。
- 并发创建 Message/Run 不产生重复 Sequence 或两个写 Run。

### 23.5 交付门禁

实现阶段每次交付至少实际执行：

- Format/Lint。
- Type Check。
- Unit/Integration Tests。
- Production Build。
- 核心 E2E。
- Migration 与 RLS Tests。

只有真实通过的检查才能记录为通过。

## 24. 部署与运维

### 24.1 环境

- Local：Supabase Local 或独立开发项目、Vercel Development Sandbox、Mock LLM 默认开启。
- Preview：每个 PR 使用隔离配置和测试数据，禁止复用 Production Secret。
- Production：Vercel + Supabase Production + OpenRouter Production Key。

### 24.2 数据库迁移

- SQL Migration 是 Schema、Index、Trigger、RLS 和 Function 的唯一事实来源。
- Migration 先在空库和生产数据副本验证。
- 破坏性变更采用 Expand → Migrate → Contract，不在一次部署内直接删除正在使用的列。
- 数据回填可恢复、可观测并设置批量上限。

### 24.3 发布顺序

1. 校验环境变量和 Provider 连接。
2. 执行向后兼容 Migration。
3. 部署 Next.js 与 Workflow 新版本。
4. 运行 Smoke Test。
5. 逐步启用新 Agent/Tool 配置。
6. 确认旧 Workflow 可在其绑定版本完成。

### 24.4 回滚

- 应用回滚不自动回滚数据库。
- 新代码必须兼容迁移后的 Schema。
- Agent Definition 和 Tool Registry 按版本引用，可禁用新版本而不修改历史。
- Publish 回滚指向上一个 Ready Publication，不删除失败证据。

## 25. 分阶段实施计划

### Phase 0：基础工程与安全边界

- 初始化 Next.js App Router、TypeScript、pnpm、Lint/Test/Build。
- Supabase Local/Remote 配置、Auth SSR、Migration、RLS 测试。
- Env Schema、日志脱敏和错误协议。
- Provider Adapter 接口和确定性 Fake。

### Phase 1：项目与对话纵向闭环

- Dashboard、原子创建项目、主对话和 Run。
- OpenAI SDK → OpenRouter 文本流。
- Workflow 持久运行、Message/Trace/Outbox。
- Realtime + Cursor 补拉。
- Engineer Mode 使用已确认的 `alex@1`；未接入的 Tool 能力必须明确显示为不可用。

### Phase 2：Sandbox 与统一画布

- Sandbox 创建/恢复/休眠。
- Workspace Tools、Monaco Editor、Terminal Viewer。
- Dev Server、Preview 隔离和 Follow Events。
- Snapshot、Candidate/Stable Version 与失败保护。

### Phase 3：Team Mode

- Agent Registry 同步投影。
- 自动/用户指定 Scheduler。
- Team Plan、Agent 状态、单写者合并和汇总。
- Agent 头像、Tool 展示与 Trace 筛选基础。

### Phase 4：GitHub 与 Publish

- GitHub App 安装、源码同步和 Webhook。
- Publish Workflow、部署状态和失败保留。
- 版本恢复与发布回滚。

每个 Phase 都必须形成可运行纵向流程，不能以静态假数据代替未完成后端。

## 26. 待确认项

### 26.1 Agent 配置后续事项

以下事项不再阻止 Engineer Mode 的 Workspace 文件闭环，但会阻止相应能力被标记为可用：

1. 五个 Agent 的头像资源。
2. Mike、Emma、Bob、David 的可执行 Tool Allowlist、Schema、权限和限制。
3. Alex 的 Sandbox、Terminal、Preview、Validation、Supabase 和部署 Tool。
4. Team Mode Scheduler/Executor、交接产物协议、汇总步骤和并行锁实现。
5. Agent 级模型覆盖、OpenRouter 备用模型及能力路由策略。

### 26.2 产品与交互事项

1. 首次项目默认 Mode。
2. 用户指定 Agent 是 Run 级还是 Project 级。
3. 执行中消息是排队、打断还是补充当前 Run。
4. 用户是否允许直接输入 Terminal 命令。
5. 用户与 Agent 并发编辑的最终冲突交互。
6. 手动切换 View 后跟随如何恢复。
7. Version、Remix 和 Publish 的完整规则。

### 26.3 平台与运维事项

1. Supabase Project URL、Publishable Key 和 Secret Key 的配置时间。
2. Vercel Workflow、Sandbox、Storage、Realtime 和 OpenRouter 的预算与限额。
3. Sandbox 网络 Allowlist 和允许的依赖 Registry。
4. Snapshot 的永久归档策略和保留期。
5. GitHub/Pubish 是否属于 P0。
6. 数据区域、日志保留、用户删除和合规要求。
7. `/test_cases` 是否继续忽略，还是作为回归 Fixture 提交。

## 27. 架构决策记录（ADR 摘要）

### ADR-001：模型调用统一使用 OpenAI SDK

- 状态：已接受。
- 原因：用户明确要求；OpenRouter 提供 OpenAI-compatible 接入。
- 结果：不使用 Vercel AI SDK 作为模型或 Agent 抽象。

### ADR-002：Postgres 是执行事件事实来源

- 状态：已接受。
- 原因：Realtime 不保证作为永久历史；PRD 要求刷新和断线恢复。
- 结果：先持久化，再通过 Outbox 广播；客户端用 Sequence 补拉。

### ADR-003：长任务使用 Vercel Workflow

- 状态：已接受。
- 原因：Vercel Function 有执行时限，普通后台 Promise 无法保证长 Agent Run 完成。
- 结果：Route Handler 快速返回，Agent Loop 持久执行并在 Step 边界恢复。

### ADR-004：生成代码只在 Vercel Sandbox 执行

- 状态：已接受。
- 原因：满足不可信代码隔离和真实 Preview 需求。
- 结果：宿主应用禁止执行生成 Shell 或代码；所有 Tool 经 Policy。

### ADR-005：Agent 定义以服务端版本化注册表为权威

- 状态：已接受。
- 原因：Agent 不允许用户创建，Prompt 与 Tool 权限属于安全边界。
- 结果：数据库仅保存 UI 投影和历史版本引用；Agent 数量暂不确定。

### ADR-006：P0 项目采用单写者工作树

- 状态：已接受。
- 原因：多 Agent 和用户并发写同一文件系统容易产生不可预测覆盖。
- 结果：推理可并行，写文件、命令、快照串行；冲突使用 Revision 显式处理。

## 28. 官方参考资料

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Supabase Auth with Next.js](https://supabase.com/docs/guides/auth/quickstarts/nextjs)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase Realtime Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Vercel Sandbox Snapshots](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)
- [Vercel Functions Runtime](https://vercel.com/docs/functions/runtimes)
- [Vercel Workflows](https://vercel.com/workflows)
- [OpenRouter: Using the OpenAI SDK](https://openrouter.ai/docs/quickstart)
- [OpenAI SDK Responses and Streaming Reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)
- [GitHub Apps and OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)
