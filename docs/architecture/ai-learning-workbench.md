# AI 学习工作台边界

> 已移除。应用内 AI 学习工作台、路由和模块均已删除。数据库表保留；不要新增删除迁移。本说明为历史归档。

AI 学习上下文拥有持久化的学习对话、不可变的上下文快照、运行标识、反馈以及通用预览序列化。它不拥有宫殿编辑、测验发布、模型管理或提示词管理。

## 依赖方向

```text
review presentation -> widgets/mindmap-review-flow -> /ai-learning API
ai_learning application -> platform.application.AiRuntimeProvider
ai_learning presentation -> settings.api.SettingsAiRuntimeProvider
business result actions -> owning public facade (palaces or palace_quiz)
```

## 不变量

1. 每次运行都携带稳定的 `owner_id` 和唯一的 `operation_id`；重试和后续操作会创建新记录，而不是覆盖历史。
2. 上下文快照包含来源实体、来源修订、有序稳定的节点 UID、选定范围以及非机密的模型快照。
3. 预览和执行使用相同的服务器序列化器。上下文预算警告是显式的；不允许静默截断。
4. API 密钥和提供方凭据绝不会被持久化或返回。
5. AI 输出绝不直接编辑宫殿或发布测验题目。仍需要由领域拥有的确认命令。
6. 复习默认使用当前活动子树，并回退到当前复习节点集合，绝不会自动回退到完整脑图。
7. 原生全屏会把工作台渲染在活动的全屏元素内；可编辑控件通过既有的键盘目标守卫抑制复习键盘快捷键。

## 前端归属

- `modules/settings/domain/ai-runtime-entity` 拥有可复用的模型、思考模式和每次运行的提示词配置。
- `widgets/mindmap-review-flow` 拥有复习工作台组合和 AI 学习运行呈现。
- `widgets/mindmap-review-flow` 组合复习专用工作台和任务操作。
- 新的 AI 入口必须复用这些公共实体，而不是重新创建模型选择器或请求预览逻辑。

## 生成配置工作台

`modules/settings/domain/ai-runtime-entity` 还通过设置公共门面暴露供脑图导入和测验生成使用的共享运行前配置对话框。业务模块可以提供场景键、提示词模板、可选的上下文选项，以及消费结果的命令；但它们不得直接导入运行时实体的私有模型文件。

1. 对话框显示完整的有效单次运行提示词，支持直接编辑、恢复场景默认值，并在所选场景允许的模型之间切换，而不更改全局默认值。
1a. 模块化提示词块按场景限定作用域（`applicable_scene_keys`）。运行对话框只列出当前场景的块，按层（角色/任务/内容/边界/输出/质量）分组，并预勾选场景默认组合（`block_keys`，回退到 `recommended_block_keys`）。空的模块化默认值会在种子数据初始化时从目录中修复。
2. 脑图和测验上下文选项默认不勾选。选中一项会把带标签的只读快照追加到最终提示词；之后的文档编辑不会改变已确认的载荷。
3. UI 显示保守的 token 估算，并在超过安全预算时阻止确认，而不是静默截断上下文。
4. 确认会返回不可变的 `AiRuntimeOptions` 载荷。所属的导入或测验用例会把该载荷与其操作记录一起持久化，并且仍需要单独的结果应用命令。
5. 重新运行会把先前的来源/配置快照恢复到新的操作中。旧操作 ID 和结果保持不变，防止过期的异步响应更新新的运行。

```text
business module/page -> modules/settings/public -> scenario/prompt APIs
business context serializer -> AiGenerationContextOption -> immutable prompt snapshot
AI result preview -> owning domain confirmation command
```
