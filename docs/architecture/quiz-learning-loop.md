# 测验学习闭环

每道未删除的题目都可练习。随心与宫殿测验不以 `lifecycle_status` 作为成员资格门槛。软删除题目保持隐藏。存储列仍可能写着 `published`、`candidate`、`temporary` 或 `rejected`；这些值不是练习的门槛，也不会被批量重写。

## 生命周期

题目发布状态已废除。不存在审核队列，不存在审核发布操作，也不存在使题目获得资格的转换。`POST /palace-quiz-questions/{id}/lifecycle` 返回 HTTP 410，详情为 `题目不再区分发布状态。` `GET /palace-quiz-questions/review-queue` 返回空列表。质量复审端点仍可描述证据缺口，但它不决定题目能否被练习。

## 证据与质量

结构化证据仍可随题目存储。练习前不要求它存在。

## 作答事件与标记

`QuizAttemptEvent` 是新分析跨场景的事实来源。遗留计数器和随心历史仍是兼容性投影。事件捕获题目/版本标识、场景、答案、正确性、时长、提示、重练次数、置信度和可选的 AI 分数。

题目掌握度不是练习过滤器。作答仍会显示对错以及存储的分析。学习者对题目的标记是 `marked`（玫瑰色书签）和 `needs_mutation`（待换题）。二者都不会改变 `schedule_stage`、`schedule_due_on`、`schedule_passed` 或宫殿复习单元。宫殿记忆卡评分（忘记 / 困难 / 记得 / 轻松）和今日脑图到期队列保持不变。

## AI 变体与待换题

题目行始终保留原始内容。外部 AI 重写内容存放在 `variant_history_json` 中，`active_variant_id` 选择显示的版本；切回 `original` 无需快照。练习按活动变体评分。`needs_mutation` 可以手动切换，或由可配置的肌肉记忆规则设置（默认 3 次作答 / 连续 3 次正确 / 5 秒以内）。数据形态、API 和随心作答归属规则见 `question-variants.md`。

AI 出题、讲解、纠错和自由提问已禁用。这些 HTTP 入口会在任何模型调用之前返回 403。已存储题目保留。英语 TTS、语音教练和宫殿卡片复习保持不变。

## 依赖方向

```text
practice presentation -> quiz HTTP API
quiz presentation -> quiz.application.learning_loop
quiz.application.learning_loop -> ORM tables + serialization
```

按实体划分的异步生成必须在候选持久化或 UI 替换之前携带稳定的所有者和操作标识。
