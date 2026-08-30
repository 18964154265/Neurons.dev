begin;

update public.agent_definitions_projection
set enabled = false, updated_at = now()
where agent_key not in ('mike', 'emma', 'bob', 'alex', 'david');

insert into public.agent_definitions_projection (
  agent_key, definition_version, display_name, description, avatar_path, tool_labels, enabled
) values
  (
    'mike', 1, 'Mike', 'Team Lead — 理解用户目标，拆分任务并协调团队交付。', null,
    '["项目上下文读取", "Agent 分配和取消", "工作流状态管理", "结果汇总", "请求关键决策"]'::jsonb,
    true
  ),
  (
    'emma', 1, 'Emma', 'Product & Research — 把模糊想法整理成清晰、可实现、可验收的产品需求。', null,
    '["Web Research", "项目文档读取", "PRD 和用户故事", "Preview 页面观察", "产品与 UX 分析"]'::jsonb,
    true
  ),
  (
    'bob', 1, 'Bob', 'System Architect — 将产品需求转换成安全、清晰、可实现的技术方案。', null,
    '["代码库与依赖分析", "数据库 Schema 设计", "API 与事件协议设计", "Auth、RLS 和权限检查", "技术文档检索", "架构风险分析"]'::jsonb,
    true
  ),
  (
    'alex', 1, 'Alex', 'Full-stack Engineer — 负责真正编写、运行、修复和交付应用。', null,
    '["文件读取、创建和修改", "Terminal", "浏览器与 Web Preview", "前后端开发", "Supabase 集成", "测试与构建", "部署准备"]'::jsonb,
    true
  ),
  (
    'david', 1, 'David', 'Quality & Data Engineer — 用测试和证据判断产品是否真正可用。', null,
    '["Playwright", "单元与集成测试", "类型检查和构建验证", "数据库只读检查", "Trace 和日志分析", "Preview 交互验收"]'::jsonb,
    true
  )
on conflict (agent_key, definition_version) do update
set display_name = excluded.display_name,
    description = excluded.description,
    avatar_path = excluded.avatar_path,
    tool_labels = excluded.tool_labels,
    enabled = excluded.enabled,
    updated_at = now();

commit;
