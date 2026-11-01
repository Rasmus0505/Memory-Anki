# 题目变体与肌肉记忆标记

做题可能变成一种识别反射：学习者记住的是题干的前半段或正确选项的位置，而不是概念。此工作流会标记这类题目，将当前显示的内容及其绑定的脑图上下文发送给外部 AI，并把返回的改写结果存为同一题目 id 的可选变体。

## 核心不变量：题目行就是原题

`palace_quiz_questions.stem`、`options_json`、`answer_payload_json` 和 `analysis` 始终保存原题。变体绝不覆盖该行。`active_variant_id` 选择做题时显示的内容：

- `original` —— 行内容。
- `v1`、`v2`、…… —— `variant_history_json` 中的一条记录。

`variant_history_json` 是一个 JSON 数组，元素为 `{version_id, created_at, question_type, stem, options, answer_payload, analysis, base_version_id, source}`。因此只要把 `active_variant_id` 设回 `original` 就总能恢复原题；不存在第二个可能漂移的快照。

`serialize_question_content` 会把活动变体应用到读取结构上。当有变体处于活动状态时，它还会返回 `original_content`，这样管理编辑器可以继续编辑原始行，而不会把变体内容保存回去覆盖它。

## 标记与自动标记

`needs_mutation` 是学习者的待换题标记。它与 `marked`（玫瑰色题号书签）相互独立，且不安排复习。

每次标准作答都会更新 `mutation_attempt_count`、`consecutive_correct_count` 和 `last_answer_duration_ms`。自动标记规则读取三个运行时设置：

| 键 | 默认值 |
|---|---|
| `quiz_mutation_min_attempts` | `3` |
| `quiz_mutation_min_consecutive_correct` | `3` |
| `quiz_mutation_max_duration_ms` | `5000` |

当答案正确、耗时低于阈值、尝试次数与连续正确计数达到各自阈值，且题目尚未被标记时，它会标记该题。这些设置存储在共享的 `config` 表中，并与复习设置一起暴露。

标准作答的归属很重要，因为随心会同时记录一次选择尝试（`/choice-attempts`）和一次历史尝试（`/freestyle/question-attempts`）。因此选择尝试会发送 `update_mutation_stats: false`，由历史记录拥有这些计数器。随心的编排还会跳过应用选择响应中的题目，这样落后一个事务的响应就无法在信息流中覆盖历史更新。

## API

| 方法 / 路径 | 用途 |
|---|---|
| `POST /palace-quiz-questions/{id}/mutation-mark` | 切换 `needs_mutation`。 |
| `GET /palace-quiz-questions/{id}/versions` | 原题 + 已存变体 + 计数器。 |
| `POST /palace-quiz-questions/{id}/active-variant` | 切换 `original` / `v1` / ……；重置当前检查。 |
| `DELETE /palace-quiz-questions/{id}/variants/{version_id}` | 删除一个变体；原题不可删除。 |
| `POST /palace-quiz-question-variants/import` | `{items, dry_run}` 批量导入；逐项校验，跳过不合格项。 |
| `POST /palace-quiz-mutation-prompt` | 为范围内已标记的题目构建可直接复制的提示词。 |

`record_choice_attempt` 依据生效（活动变体）答案评分，而不是原始行。尝试事件还会额外存储 `question_version_id`。

导入会依据原题校验 `question_type`，保留原题的单选/多选作答模式，规范化 `【AI变体】` 来源标签且不重复添加，并拒绝 `base_version_id` 已不再匹配该题活动版本的项。成功导入会追加变体、将其激活、清除 `needs_mutation`，并重置连续正确与耗时计数器，使新变体从零开始检查。

## UI 界面

`QuizQuestionVariantControl` 是共享的逐题控件：原题/变体徽章、标记换题 / 待换题、恢复真题和历史版本。它挂载在：

- 随心测验卡片。
- 随心做题叠加层（`FreestyleScopeQuizDialog`）。
- 节点绑定题目对话框（`NodeBoundQuizDialog`）。
- 宫殿测验练习卡片和宫殿题目管理列表。

`QuizMutationBatchBar` 会向两个叠加层头部和宫殿题目管理头部添加“一键复制待换题 + Prompt”和“导入 AI 替换题 JSON”。提示词端点会把传入的 id 过滤为 `needs_mutation = true`，因此按钮中的计数与提示词正文一致。

切换或恢复版本会重置该题的本地作答状态，因为题干、选项和答案都已改变。导入会对每个导入的题目做同样的事。

## 节点上下文

提示词会为每个绑定包含宫殿标题、祖先路径、节点文本、备注，以及最多八个子文本。`build_document_tree` 暴露这些字段；项目读取的是脑图编辑器所用的同一份 `palaces.editor_doc`。如果某个绑定是历史错绑，提示词中的错绑节点豁免规则会告诉模型忽略它，改用原题和分析。

## 相关代码

- `modules/quiz/application/question_variants.py` —— 规范化、生效内容、变体序列化。
- `modules/quiz/application/question_variant_commands.py` —— 标记、激活、删除、导入。
- `modules/quiz/application/question_variant_prompt.py` —— 提示词构建器。
- `modules/quiz/application/auto_mark.py` —— 标准尝试计数器与自动标记规则。
- `modules/settings/infrastructure/quiz_mutation_settings.py` —— 阈值读取。
- `apps/web/src/modules/quiz/domain/quiz-entity/ui/QuizQuestionVariantControl.tsx`、
  `QuizQuestionVersionSheet.tsx`、`QuizMutationBatchBar.tsx` —— 共享 UI。
