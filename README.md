# Neurons.dev

Neurons 是一个面向大众的 AI Native Vibe Coding 工作区。用户通过对话创建项目，并在同一个工作区查看代码、Terminal、Web Preview 和 Trace。

## 本地运行

### 1. 环境要求

- Node.js `>=24 <27`
- pnpm `11.24.0`
- 一个 Supabase 项目
- 一个 OpenRouter API Key 和可用模型
- 一个已关联项目的 Vercel 账户（使用真实 Terminal 时需要）

确认版本：

```bash
node --version
pnpm --version
```

如果本机没有 pnpm：

```bash
npm install --global pnpm@11.24.0
```

### 2. 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 3. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

填写 `.env`，不要提交该文件。必需配置如下：

| 变量                                             | 用途                                   |
| ------------------------------------------------ | -------------------------------------- |
| `DATABASE_URL` 或 `POSTGRESQL`                   | Supabase Postgres 连接串，只需设置一个 |
| `OPENROUTER_API_KEY`                             | OpenRouter 服务端密钥                  |
| `OPENROUTER_DEFAULT_MODEL` 或 `OPENROUTER_MODEL` | OpenRouter 模型 ID，只需设置一个       |
| `OPENROUTER_BASE_URL`                            | 默认 `https://openrouter.ai/api/v1`    |
| `NEXT_PUBLIC_SUPABASE_URL`                       | Supabase Project URL                   |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`           | Supabase Publishable Key               |
| `APP_URL`                                        | 本地使用 `http://localhost:3000`       |
| `SUPABASE_SECRET_KEY`                            | 当前为可选服务端配置，不得暴露给浏览器 |
| `VERCEL_TEAM_ID`                                 | 本地 Vercel Sandbox 所属 Team ID       |
| `VERCEL_PROJECT_ID`                              | 本地 Vercel Sandbox 所属 Project ID    |
| `VERCEL_TOKEN`                                   | 本地 Vercel Access Token               |

项目工作区中的真实 Terminal 由 Vercel Sandbox 执行。在 Vercel 部署环境中优先使用平台注入的 `VERCEL_OIDC_TOKEN`；本地开发必须同时配置 `VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID` 和 `VERCEL_TOKEN`。缺少凭据时页面仍可启动，但 Agent 调用 `terminal_run` 会以 `VERCEL_SANDBOX_CREDENTIALS_MISSING` 安全失败，不会回退到宿主机 Shell。

如果数据库直连 URI 在本地网络不支持 IPv4，请使用 Supabase Dashboard 提供的 Session Pooler URI。连接串中的密码包含特殊字符时，需要按 URI 规则编码。

### 4. 初始化数据库

首次运行前，按文件名顺序执行 [`supabase/migrations`](./supabase/migrations/) 中的全部迁移：

```text
202608290001_initial_schema.sql
202608290002_run_commands.sql
202608290003_confirm_run_cancel.sql
202608300001_agent_definitions.sql
202608300002_fix_run_cancel_ambiguity.sql
202608300003_backfill_default_agent_assignments.sql
202608300004_project_files.sql
```

可以在 Supabase Dashboard 的 SQL Editor 中逐个执行。也可以使用 Supabase CLI 对远程数据库执行迁移；无论使用哪种方式，都不要把连接串写入仓库或终端日志。

`agent_definitions` 迁移会写入 Mike、Emma、Bob、Alex 和 David 的安全展示投影。服务端权威配置仍位于 [`lib/agents/registry.ts`](./lib/agents/registry.ts)，数据库中的能力标签不代表可执行 Tool 权限。`project_files` 迁移为 Alex 的受控 Workspace 文件工具和右侧 Editor 提供持久文件投影。

### 5. 配置 Supabase Auth

在 Supabase Dashboard 中打开 **Authentication → URL Configuration**：

- Site URL：`http://localhost:3000`
- Redirect URLs：加入 `http://localhost:3000/**`

在 **Authentication → Providers → Email** 中确认：

- Email Provider 已启用。
- 用户注册已启用。
- 是否要求邮箱确认按开发环境需求设置；应用同时支持需要确认和自动确认两种结果。

已有 Magic Link 账户可以在登录页通过“忘记密码”设置密码，仍会使用原来的 Supabase 用户身份和项目数据。

### 6. 启动开发服务器

```bash
pnpm dev
```

浏览器打开：

```text
http://localhost:3000
```

开发模式支持热更新。如果系统报告 `EMFILE: too many open files`，可以关闭其他文件监听进程，或改用下面的生产预览模式。

### 7. 本地生产预览

先构建：

```bash
pnpm build
```

再启动：

```bash
pnpm start
```

默认地址仍为 `http://localhost:3000`。

## 本地检查

提交代码前建议依次运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

自动化测试不会调用真实付费模型。需要验证 OpenRouter、注册确认邮件或完整登录恢复流程时，应使用专门的测试账户并控制外部调用成本。

## 会话与数据恢复

- 登录 Session 由 `@supabase/ssr` 写入 Cookie。
- `proxy.ts` 会在请求期间验证并刷新过期的 Access Token。
- 用户刷新页面或重新打开浏览器后，只要 Refresh Session 仍有效，就会继续保持登录。
- 主动退出、Refresh Session 被撤销或最终失效后，需要重新登录。
- 项目数据通过 `owner_id = auth.uid()` 和 RLS 绑定到 Supabase 用户；同一个账户重新登录后可以恢复之前的项目。

## 重要文件

- [`PRD.md`](./PRD.md)：产品需求
- [`TRD.md`](./TRD.md)：技术方案
- [`AGENTS.md`](./AGENTS.md)：长期工程约束
- [`developer.md`](./developer.md)：用户要求提交时生成的变更概要
- [`supabase/migrations`](./supabase/migrations/)：数据库迁移
- [`lib/agents/registry.ts`](./lib/agents/registry.ts)：Agent 权威配置
