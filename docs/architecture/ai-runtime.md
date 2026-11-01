# AI 运行时边界

AI 模型选择是平台能力，而模型目录管理与持久化设置仍归 `settings` 上下文所有。

## 依赖方向

```text
business application -> platform.application.AiRuntimeProvider
settings.api -> settings.infrastructure.SettingsAiRuntimeProvider -> settings application registry
presentation/composition -> constructs adapter -> injects provider into business use case
```

业务模块不得导入 `settings.application` 或 `settings.infrastructure` 来解析模型运行时细节。它们接收平台端口，并基于 `AiRuntimeOptions` 与 `ResolvedAiRuntime` 工作。

## 迁移状态

- 挂钩联想和英语听力（DashScope ASR + LLM 翻译）使用平台运行时端口。应用内 AI 分卡、PDF/图片脑图导入、测验生成、英语阅读和 PDF 库已移除；其数据表保留。
- 英语课程生成会在每个任务旁持久化非机密的 ASR 与翻译运行时快照，在 worker 内恢复当前凭据，并在重试之间携带稳定的 `ownerId`/`operationId`。
- 英语表现层通过 `memory_anki.modules.settings.api` 组合 `SettingsAiRuntimeProvider`；英语应用层和基础设施层不再导入设置应用层内部实现。
- 提示词目录依赖与运行时解析分开跟踪。听力场景为 `asr_course_transcription` 和 `translation_course_batch`。挂钩联想保留 `peg_association_suggestions`。
- 设置 UI 暴露五个顶层工作区（`access`、`models`、`scenes`、`blocks`、`observability`）；提示词组合保留在提示词设置 API 中，而 Provider/模型/场景调用保留在模型设置 API 中。
- 英语听力通过注入的 `AiRuntimeProvider` 和 `infrastructure/llm/openai_compatible.py` 解析凭据。`infrastructure/llm/gateway.py` 在其非英语调用方被删除后已移除。

## 不变量

1. Provider 密钥和目录 ORM 模型绝不进入业务上下文。
2. 运行时 DTO 只包含可直接调用的值和公共元数据。
3. 规范化在调用用例之前于组合边界发生。
4. 业务用例显式接收提供方；它们不自行解析全局设置。
5. 持久化的 worker 快照绝不包含 API 密钥；worker 在执行时恢复当前凭据。
6. 按实体划分的后台工作会在启动前持久化稳定的所有者和操作标识。
7. `AiRuntimeOptions.prompt_options` 独立于模型解析携带模块化提示词选择。
8. 持久化的运行时快照保留 `prompt_options` 和编译后的提示词，以便复现。
9. Provider 的 API 密钥行即使在值为空时也是权威的。空值是一个持久墓碑，阻止环境变量回退，直到用户保存新密钥；Base URL 保持其现有的空值回退行为。
10. 带 `clear_all_api_keys: true` 的 `PUT /settings/ai-models` 会为每个可配置 Provider 和 `mindmap_ai_split_api_key` 写入墓碑，使遗留和当前调用路径一并停止。
