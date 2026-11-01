# 模块：quiz

## 状态
活跃 —— 拥有当前的题目和测验学习契约。

## 负责
题目、绑定、生成工作区、错题集

## 迁移自
- palace_quiz

## 禁止
不得涉及正式复习会话生命周期

## 公共接口
- `public/commands.py` — 写意图
- `public/queries.py` — 读契约

## 选择题契约
- 单选题：`answer_payload.correct_option_id`；作答提交 `selected_option_id`。
- 多选题：`answer_payload.correct_option_ids`（≥2 个，按选项顺序）；作答提交 `selected_option_ids`，按集合完全一致判对。
- 前端 `QuizQuestionInteraction` 检测到 `correct_option_ids` 时渲染多选切换 + 提交按钮，提交前 `isQuizChoiceAttemptClosed` 保持未关闭。

## AI 变体工作流

题目行始终保留原始内容。AI 变体存放在
`variant_history_json` 中；`active_variant_id` 决定练习显示哪一个。
`needs_mutation` 是学习者的待换题标记，与 `marked` 相互独立。
肌肉记忆规则通过公共门面
`memory_anki.modules.settings.api.read_quiz_mutation_settings` 读取其三个阈值。请参阅
`docs/architecture/question-variants.md`。

## 跨模块规则
只导入 `memory_anki.modules.quiz.public`。绝不要导入另一个模块的 application/infrastructure/presentation。
