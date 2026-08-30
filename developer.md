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
