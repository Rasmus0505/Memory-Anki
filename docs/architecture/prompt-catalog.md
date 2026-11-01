# 提示词目录边界

提示词归属与自定义属于 `settings` 上下文。业务用例引用稳定的提示词键，并通过 `platform.application.PromptCatalog` 渲染它们。

## 依赖方向

```text
business application -> platform.application.PromptCatalog
settings.api -> settings.infrastructure.SettingsPromptCatalog -> settings prompt registry
presentation/composition -> constructs adapter -> injects catalog into use case or worker
```

## 不变量

1. 业务上下文不导入设置提示词模板或注册表辅助工具。
2. 模板默认值、持久化覆盖、占位符和渲染仍归设置所有。
3. 业务代码拥有提示词键和输入变量，而不是模板文本。
4. 后台 worker 接收与会话无关的目录适配器；请求会话绝不会被 worker 线程捕获。
5. AI 运行时选择与提示词渲染仍是独立的端口。
6. 可复用提示词块、块版本、场景默认值和场景版本归 `settings` 所有。
7. 编译后的提示词始终遵循固定顺序：角色、任务、内容保真、边界、输出 schema、质量、场景指令、运行指令。
8. 每次 AI 调用都会持久化最终编译文本以及选中的块键、块版本、场景版本和仅运行指令。
9. 所有交互式 AI 运行都使用 `prompt_options` 组合；全模板覆盖 API 已停用。
10. 浏览器存储可以保留模型选择和未完成的运行指令，但绝不替代服务器场景默认值。

## 组合流程

```text
settings prompt block library
  + active scene default (block keys + scene instruction)
  + optional run selection
  + optional run-only instruction
  -> PromptCatalog.compose
  -> compiled prompt snapshot
  -> AI runtime request/task audit record
```

所有块都是可选的。移除推荐块会产生确定性的风险警告，但不会阻止生成。保存场景默认值会立即激活新版本，并归档先前版本以供回滚。更新共享块需要确认每个受影响的场景。

提示词组合仅使用场景默认值和模块化块。已停用的全模板覆盖与评估 API 不属于当前目录。

## 迁移状态

- 宫殿 AI 分卡、脑图导入、英语阅读、AI 学习与批量生成已随功能下线而移除（代码删除，数据表保留）；挂钩联想等仍在使用。
- 英语课程批量和单句翻译已通过 `PromptCatalog` 迁移。
- 场景默认值暴露面向用户的 `label` / `category` 供选择；AI 分卡使用统一场景键 `ai_split`。
- AI 生成 UX 应通过前端 `backgroundTaskRegistry` 注册进度，以便用户在模型运行时看到阶段进度。
