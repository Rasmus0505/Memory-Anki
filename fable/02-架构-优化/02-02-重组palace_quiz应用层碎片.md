---
编号: 02-02
标题: 将 palace_quiz application 层约 124 个碎片文件按用例聚合为 10 个左右内聚模块
类型: 优化
范围: 架构
优先级: P1（应该）
预估工作量: L（>8h）
依赖文档: 无（建议在 02-13、02-15 之前完成，避免这两篇文档的清单指向被移走的文件）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-02 重组 palace_quiz application 碎片

## 1. 原始需求

`apps/api/src/memory_anki/modules/palace_quiz/application/` 目录下有 **124 个文件**（含 `__init__.py`），其中绝大多数是 11-100 行的超细粒度碎片，按 `*_request` / `*_payload` / `*_context` / `*_preview` / `*_runtime` 等后缀机械切分。实测举例（行数为 `Get-Content` 统计）：`quiz_generation_messages.py` 11 行、`quiz_generation_shared.py` 11 行、`question_dedup.py` 15 行、`quiz_grouping_runtime.py` 15 行、`quiz_generation_child_chapter_runtime.py` 16 行、`question_scope_ids.py` 17 行。一个"章节大纲出题"用例被切成 `quiz_generation_chapter_outline{,_support,_preview,_request,_request_payload,_request_context}` 6 个文件。后果：阅读一个用例要跳 5-8 个文件；新增字段常常要同时改 request/payload/context 三个文件；import 图庞大脆弱。

期望效果：按**用例**聚合为 10 个左右内聚文件（每个 100-600 行，上限对齐 `ralph/prd.json` 的 350 行精神但允许聚合初期略超），文件内按"入参规整 → 校验 → 执行 → 序列化"排列；对外导出符号（被 presentation 层与其他模块 import 的函数）全部保持原名。

## 2. 详细执行清单

> 禁止事项（全程适用）：**只做移动与合并，严禁改写任何函数体逻辑**；不要重命名任何函数/类/常量；不要动 `palace_quiz/presentation/router.py` 中 handler 的行为（只允许改 import 行）；不要动 `apps/api/pyproject.toml` 的 mypy 豁免列表（该目录 3 个模块在豁免中，摘除豁免由 02-15 负责）；合并时若两个文件有同名私有辅助函数（如各自的 `_int_or_none`），保留一份并确认实现一致，不一致则各自加前缀保留两份。

### 步骤 0：生成 import 反查表

执行并把输出保存到临时笔记（不要提交进仓库）：

```
rg -n "from memory_anki.modules.palace_quiz.application" D:\322321\Memory-Anki\apps\api\src D:\322321\Memory-Anki\apps\api\tests
```

这份清单决定每批迁移后要改哪些 import。凡是**目录外**（presentation、其他模块、tests）引用到的符号，迁移后必须可从新文件 import 到。

### 步骤 1：确认目标文件划分表

目标：124 个文件 → 12 个文件。划分表（"来源文件"按前缀通配，具体名单以目录实际 `Get-ChildItem` 为准）：

| 目标文件 | 来源文件（合并进来的碎片） | 预估行数 |
|---|---|---|
| `ai_runtime.py` | `ai_service.py` + `ai_service_runtime*.py` 共 10 个（`ai_service_runtime.py`、`_request`、`_sync`、`_stream`、`_calls`、`_config`、`_errors`、`_logging` 等） | ~550 |
| `question_read.py` | `question_*_queries.py` 全部（lookup/entity/listing/row/row_scope/sort_order/explicit_chapter/dedup_queries）+ `question_serialization*.py` 3 个 + `question_contracts.py` + `question_schema.py` + `question_scope_ids.py` + `question_scope_entities.py` | ~600 |
| `question_write.py` | `question_commands.py`、`question_creation_commands.py`、`question_update_commands.py`、`question_delete_commands.py`、`question_classification_commands.py`、`question_lifecycle_commands.py`、`question_attempt_commands.py`、`question_write_support.py`、`question_write_rows.py`、`question_write_commits.py`、`question_record_support.py`、`question_batch_creation_support.py`、`question_row_ordering.py` | ~650 |
| `question_validation.py` | `question_validation.py`、`question_validation_scope.py`、`question_validation_content.py`、`question_answer_*validation*.py` 4 个、`question_option_validation.py`、`question_scope_validation.py`、`question_scope_rules.py` | ~500 |
| `question_dedup.py`（保留名，吸收同族） | `question_dedup.py`、`question_dedup_keys.py`、`question_duplicate_lookup.py`、`question_import_dedup.py` | ~230 |
| `question_source_meta.py`（保留名） | `question_source_meta.py`、`question_source_meta_shared.py`、`question_source_meta_review.py`、`question_generation_source_meta.py` | ~180 |
| `quiz_generation_text.py` | `quiz_generation_text_*.py` 5 个（request/request_payload/preview/support/files）+ `manual_text_quiz_parser.py` + `quiz_generation_drafts.py`（即 `question_generation_drafts.py`）+ `question_generation_payloads.py` | ~1100，**唯一允许超 600 的文件**；若执行时不适，可把 `manual_text_quiz_parser.py`（589 行）独立保留 |
| `quiz_generation_image.py` | `quiz_generation_image_*.py` 4 个 + `quiz_generation_images.py` + `quiz_generation_ocr_sources.py` + `ocr_sources.py` | ~500 |
| `quiz_generation_chapter.py` | `quiz_generation_chapter_*.py` 全部（outline 6 个、scope 4 个、grouping、chaptering）+ `quiz_generation_child_chapter_*.py` 7 个 | ~800，可在文件内用 `# === 章节大纲 ===` / `# === 子章节 ===` 分节 |
| `quiz_generation_review.py` | `quiz_generation_review.py`、`quiz_generation_review_mindmap*.py` 8 个 | ~600 |
| `quiz_generation_common.py` | `quiz_generation_service.py`、`quiz_generation_shared.py`、`quiz_generation_messages.py`、`quiz_generation_prompt_messages.py`、`quiz_generation_preview_result.py`、`quiz_generation_preview_grouping.py`、`quiz_generation_editor_summary.py`、`quiz_generation_feedback*.py` 4 个、`question_generation_errors.py` | ~500 |
| `quiz_grouping.py` | `quiz_grouping_*.py` 全部 9 个（service/runtime/context/preview/ai_request/ai_runtime/existing_*） | ~450 |

保留不动的文件：`service.py`（95 行，模块门面）、`quiz_explain_question.py`（211 行，独立用例）、`_question_utils.py`（27 行，下划线私有工具）、`__init__.py`。

自查点：把目录实际文件名逐一对照上表，确认每个文件都有归属（归入某目标文件 / 保留不动）；发现表中未列出的文件时，按最接近的前缀归类并在本文档进度记录表补一行说明。

### 步骤 2：按批次迁移（每批做完必须全绿再进入下一批）

每批的机械动作模板：
1. 新建（或打开）目标文件，把来源文件内容按"常量 → 私有辅助 → 公开函数"顺序拷入，合并去重 import。
2. 删除来源文件。
3. 用步骤 0 的反查表 + `rg -n "palace_quiz.application.<来源文件名>" apps/api` 找到所有引用，改为从目标文件 import。目录内部引用同样要改。
4. 运行 `python -m pytest tests/test_palace_quiz_routes.py tests/test_freestyle_routes.py -q` 与 `python -m ruff check src/memory_anki/modules/palace_quiz`。

批次顺序（依赖少的先做）：

- 批次 1：`question_dedup.py`、`question_source_meta.py`（同名保留、只吸收 3-4 个碎片，练手确认流程）。
- 批次 2：`question_validation.py` → `question_read.py` → `question_write.py`（question 族，被 generation 族依赖，先稳定）。
- 批次 3：`ai_runtime.py`（generation 各用例的公共底座）。
- 批次 4：`quiz_generation_common.py` → `quiz_generation_text.py` → `quiz_generation_image.py`。
- 批次 5：`quiz_generation_chapter.py` → `quiz_generation_review.py` → `quiz_grouping.py`。
- 批次 6：更新 `presentation/router.py` 与目录外引用中残余的旧路径 import；跑全量测试。

每批自查点：`rg -n "from memory_anki.modules.palace_quiz.application.<已删除文件名> import" apps/api` 零匹配；本批测试命令全绿。

### 步骤 3：收尾断言

`(Get-ChildItem apps/api/src/memory_anki/modules/palace_quiz/application -File).Count` 期望 ≤ 16（12 个目标 + 4 个保留）。

## 3. 测试验收标准

可执行命令与期望结果（工作目录 `apps/api`）：

| 命令 | 期望结果 |
|---|---|
| `python -m pytest tests -q` | 全部通过 |
| `python -m ruff check src tests` | 0 错误 |
| `lint-imports` | 契约 KEPT |
| `rg -c "\.py$" --files src/memory_anki/modules/palace_quiz/application` | 文件数 ≤ 16 |
| `rg -n "quiz_generation_child_chapter_runtime\|quiz_generation_messages" src` | 零匹配（碎片文件名不再存在） |

行为验收：启动后端 → 前端进入任一宫殿的出题页 → 手动出题、AI 文本出题预览、题目归组各操作一次 → 与改造前行为一致（可对照改造前录制的响应 JSON）。

回归检查：`/api/v1` 下 palace-quiz 相关全部路由响应结构不变；`freestyle` 模块（引用了 question 查询函数）不受影响；`pyproject.toml` mypy 豁免中 `palace_quiz` 的 3 个模块名若因合并而失效，**在本文档中仅同步更新模块名**（`quiz_generation_service`→`quiz_generation_common` 等），不做摘除。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
| 2026-07-09 | Codex | 同步低冲突收尾状态 | 已删除 7 个纯转发/门面碎片（含 `question_commands.py`、`question_lifecycle_commands.py` 等）并更新引用；验证 `python -m pytest tests/test_palace_quiz_routes.py tests/test_manual_text_quiz_parser.py -q` 为 43 passed, 21 skipped，相关 ruff 通过。当前 application 顶层仍为 119 个 `.py`，尚未建立 `generation/`、`grouping/`、`questions/`、`ai_runtime/` 子包，因此保持部分完成。 |
| 2026-07-09 | Codex | 完成子包重组与收尾 | 已建立并使用 `generation/`、`grouping/`、`questions/`、`ai_runtime/` 子包；删除纯 re-export question shim 44 个与旧 generation 顶层碎片 36 个；保留必要对外锚点。验收：`application` 合计 37 个 `.py`、顶层 15 个、无 >800 行文件；旧碎片 import 仅剩允许的 `quiz_generation_service` 门面与 `question_schema` 外部引用；`python -m pytest tests/test_palace_quiz_routes.py tests/test_manual_text_quiz_parser.py tests/test_freestyle_routes.py -q` 为 51 passed, 21 skipped；相关 ruff 通过。 |
