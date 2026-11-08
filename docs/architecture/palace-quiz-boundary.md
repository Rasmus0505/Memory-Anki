# 宫殿测验边界


宫殿测验负责题目校验、分组、持久化和测验反馈；AI 题目生成入口已移除。它可以引用宫殿标识和读取投影，但宫殿实现模块不是共享库。

## 依赖方向

```text
quiz.application -> content.api
quiz.application -> mindmap_document.api
quiz.application -> platform.application AI contracts
quiz.application -> platform.application UnitOfWork
```

通用模型响应辅助函数，例如多模态图像内容编码和平衡 JSON 对象提取，位于 `platform.application.ai_content`。通用脑图遍历位于 `mindmap_document`。宫殿特有的标题、显式章节范围和迷你宫殿节点解析有意通过 `content.api` 导出。

测验应用绝不能导入 `content.application`、`content.infrastructure` 或私有脑图文档模块。

## 变更边界

四个幂等题目变更由 `palace_quiz.application.question_mutation_commands` 组合。表现层从请求头提取变更身份并构造平台 SQLAlchemy 适配器；应用命令在一个 `UnitOfWork` 事务中执行题目、遗留 `source_meta` 字段和变更响应的写入。OCR 生成/写入路径已移除，`source_meta` 仅作为兼容字段保留。

底层题目与 `source_meta` 写入辅助函数可以为命令组合执行 flush，但在由变更命令调用时不得提交。命令拥有唯一的提交，因此存储变更响应时发生失败会回滚所有业务写入。宫殿测验不得导入过渡性的 `memory_anki.modules.persistence` 上下文。

## 题库显示顺序

宫殿测验的练习、管理、聚合列表、生成预览和节点绑定叠加层都按试卷顺序呈现题库：先选择题，再其他客观题类型，最后简答题。同一类型内，依次按 `sort_order`、`id` 保持稳定。随心测验的洗牌是独立的训练抽取，不使用该题库顺序。
<!-- invariant: palace-quiz-bank-order-choice-first -->

该排序位于 `quiz.application.question_contracts`，因此列表、生成草稿和前端题库视图共享同一条规则。

## 测验–脑图节点绑定（题库结合 / 双向关联）

`quiz.application.node_binding` 将题目绑定到脑图节点 UID。一道题保留**单一所属宫殿**；每条边指向一个**目标**脑图宫殿 + `node_uid`（允许跨宫殿）。每个新的宫殿所属题目必须有**至少一个**绑定（提供了有效显式 `node_uids` 时使用它们，否则通过 `default-root-binding` 使用宫殿根 UID）；`palace_id=None` 的章节范围创建会跳过，直到分配了宫殿所有者。
<!-- invariant: palace-quiz-create-requires-node-binding -->

- 存储：`palace_quiz_question_node_bindings`
  - 边上的 `palace_id` = **目标**脑图宫殿（节点位于那里）
  - 唯一约束：`(question_id, node_uid)`；一道题只属于一座宫殿，同一题不会重复挂同一个节点
  - `source` = `ai` | `manual`
- 反向列表：`GET /palaces/{id}/quiz-node-bindings` 返回**目标**为该宫殿的每条边，包括外部所有者题目，并带有 `question_owner_palace_id` / 标题 / `is_cross_palace`。
- 逐题列表：`GET /palace-quiz-questions/{id}/node-bindings`，用于测验 → 知识点跳转。
- 节点搜索：`GET /quiz-node-search?q=`（全局或限定范围），用于出题。
- 写入路径：`POST .../preview` + `.../apply`（AI，人工确认）、`POST .../mutate`（手动；每次添加/移除可带可选 `target_palace_id`）、`POST .../auto-bind-text`（确定性的文本重叠回填）。
- 合并模式（AI 应用）：`replace_all`（清除**该目标宫殿的 AI 边**；保留手动边）和 `fill_unbound`。
- 双向 UI：
  - 地图/复习 → 共享做题窗口（`FreestyleScopeQuizDialog` 的 `source="questions"` 模式，所有者标签 本宫 / 来自·他宫）；每张卡片最多显示两个角标，表示已绑定题目的子树并集（包括跨所有者边）：**客观**（除 `short_answer` 外的所有类型，绿色）和**主观**（`short_answer`，天蓝色）。题目数为零的一侧省略。计数是完整总数，不会因完成某题而减少；会话进度保留在测验进度 UI 中。如果该客观或主观集合包含已标记的题目，该角标使用玫瑰色填充。点击角标只打开该侧的题目。书架不再画角标簇：宫殿行右侧的「做题 N」是绑定到该宫殿的去重未删除题目（当所有边仍指向活动节点时为根节点总数），点击进入该宫殿的测验页。每一行（学科 / 章节 / 宫殿）底部的细线是该行题目占比：宫殿对所属章节、章节对所属学科、学科对整座书架；百分比写在细线右端。它只衡量题目绑定得全不全，与是否作答无关。Session 已做 与随心工具栏叠加层和宫殿测验练习共享。刷新不会清除它。它由宫殿测验的手动清除清除，或在结算页选择清除那些宫殿时清除。上一个/下一个仍保留已解决状态，方便学习者回看之前的答案。测验练习使用 标记 / 取消标记，而不是 忘记/困难/记得/轻松。标记会写入 `marked`，且不安排复习或自动前进。最后一次存储的 忘记 或 困难 评分（未通过，带到期日）会迁移为已标记。索引栏上已标记的题号使用玫瑰色填充。
  <!-- invariant: palace-quiz-badge-counts-stable -->
  <!-- invariant: palace-quiz-marked-index-rose -->
  - 测验 → 多边选择器 → `QuizKnowledgeDigressionDialog` 完整只读目标脑图 + 固定的**返回做题**（叠加层；尝试草稿保留在父级内存中；PWA 返回先关闭跳转）。

## 删卡后的绑定回收

删掉一张卡片不能把题目一起带走。保存宫殿导图时（`save_palace_editor_state` 的 `editor_doc` 分支）在**同一事务**里调用 `quiz.public.commands.rehome_orphaned_question_bindings`：

- 边指向的 `node_uid` 已不在新导图中，但该题还有别的有效边 → 只删悬空边，不重复绑定；
- 该题没有任何有效边 → 把绑定改到被删节点最近的、仍存在的父级节点；没有可用父级时回退到宫殿根节点；
- 新导图没有任何节点 → 原样保留，等下一次有效保存再判。

统计侧兜底：绑定指向的 `node_uid` 在导图中已不存在时，这道题按宫殿根节点计入（`buildSubtreeQuestionMap` 把孤儿边并入根集合），因此「后端回收尚未落库」的瞬间，删卡也不会让题从任何角标计数里消失。

这覆盖正式编辑器、随心编辑、剪空删卡、版本恢复和导入应用等所有走保存接口的路径。离线修复用 `tools/repair_orphaned_quiz_bindings.py`（默认只审计，`--apply` 先整库备份）；审计报告在 `deliverables/题目绑定丢失审计-2026-11-07.md`。
<!-- invariant: palace-quiz-deleted-node-rehomes-to-root -->
