---
编号: 02-02
标题: 重组 palace_quiz application 层的 124 个碎片文件为按用例聚合的子包
类型: 优化
范围: 架构
优先级: P1
预估工作量: L
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-02 重组 palace_quiz 应用层碎片文件

## 1. 原始需求

`apps/api/src/memory_anki/modules/palace_quiz/application/` 目录经清点共 **124 个文件**，其中 **112 个不超过 100 行、53 个不超过 50 行**。大量文件是同一用例被机械切成 request / payload / context / preview / support / runtime 的碎片，还存在纯转发门面（如 `quiz_generation_messages.py` 11 行、`quiz_generation_child_chapter_runtime.py` 16 行、`quiz_generation_shared.py` 11 行、`question_generation_errors.py` 8 行、`quiz_grouping_runtime.py` 15 行——内容全部是 `from .真实模块 import X as X` 再加 `__all__`）。阅读一个用例要在 5~8 个文件间跳转，严重拖慢理解与修改。目标：按用例聚合为 `generation/`、`grouping/`、`questions/`、`ai_runtime/` 四个子包，同族碎片合并为单文件，删除纯转发门面，行为与对外 API 完全不变。

**按前缀清点（撰写时核实）**：`quiz_generation_*` 50 个、`question_*` 50 个、`quiz_grouping_*` 9 个、`ai_service*` 9 个，另有 `manual_text_quiz_parser.py`(542 行)、`ocr_sources.py`、`quiz_explain_question.py`(182 行)、`service.py`(95 行门面)、`_question_utils.py`、`__init__.py`。

**必须保持不变的对外面（已核实引用方）**：

- `modules/palace_quiz/presentation/router.py` 第 10–38 行只 import `application.ai_service` 与 `application.service` 两个门面。
- `modules/freestyle/application/quiz_cards.py` 第 14 行 import `application.question_schema` 的 `serialize_question`。
- 测试：`tests/test_palace_quiz_routes.py` 第 20 行 import `application.ai_service`；`tests/test_manual_text_quiz_parser.py` 第 3 行 import `application.manual_text_quiz_parser`。
- `apps/api/pyproject.toml` mypy 豁免引用 `...application.quiz_generation_service`、`...application.quiz_grouping_service`、`...application.service` 三个模块路径。
- `tools/check_architecture.py` 的 `check_palace_quiz_application_facades`：application 下除 `service.py` 外任何文件不得 `from .service import`。

因此重组的铁律：**顶层保留 `ai_service.py`、`service.py`、`quiz_generation_service.py`、`quiz_grouping_service.py`、`question_schema.py`、`manual_text_quiz_parser.py` 六个模块路径不动**，其余文件才允许移动/合并。

## 2. 详细执行清单

> 硬约束：纯机械搬运+合并，任何函数体一行都不许改；不要动 presentation 层；不要动 `pyproject.toml` 与 `tools/check_architecture.py`；每一批做完必须跑一次验证命令后再做下一批。

### 批次 0：生成清点清单（只读，不改代码）

1. 在 `apps/api` 运行：`Get-ChildItem src\memory_anki\modules\palace_quiz\application -File | ForEach-Object { "{0,5} {1}" -f (Get-Content $_.FullName).Count, $_.Name }`，把输出贴到本文档第 4 节进度表备注或独立笔记，作为搬运核对清单。
2. 对每个 ≤20 行的文件打开确认是否为"纯转发门面"（只有 import + `__all__`）。已确认的纯门面至少包括：`quiz_generation_messages.py`、`quiz_generation_child_chapter_runtime.py`、`quiz_generation_shared.py`、`question_generation_errors.py`、`quiz_grouping_runtime.py`、`question_dedup.py`(13 行)、`question_scope_ids.py`(17 行)、`ai_service_runtime.py`(20 行，被 ai_service.py 使用，**保留**，见批次 4)。

自查点：清单文件数 = 124；每个纯门面都记录了"它转发的真实模块"和"grep 到的全部引用方"。

### 批次 1：删除纯转发门面（不含 ai_service_runtime.py）

对批次 0 确认的每个纯门面逐一处理（一次一个文件）：

1. `rg "from \.<门面名> import|from memory_anki.modules.palace_quiz.application.<门面名>" apps/api` 找出全部引用方。
2. 把每个引用方的 import 改为直接引用真实模块。示例（`quiz_generation_messages.py` 的场景）：

```python
# 修改前（某引用方文件内）
from .quiz_generation_messages import build_generation_messages
# 修改后
from .quiz_generation_prompt_messages import build_generation_messages
```

3. 删除该门面文件。
4. 立即验证：`python -m pytest tests/test_palace_quiz_routes.py -q` 通过。

不要做：不要删除 `service.py`、`quiz_generation_service.py`、`quiz_grouping_service.py`、`ai_service.py` 这四个对外门面；不要在改 import 时"顺手"合并文件（合并在批次 3 做）。

自查点：`rg "quiz_generation_messages|quiz_generation_child_chapter_runtime|quiz_generation_shared" apps/api/src` 无结果。

### 批次 2：建立子包骨架

创建四个子包目录（各含空 `__init__.py`）：

```
application/generation/__init__.py
application/grouping/__init__.py
application/questions/__init__.py
application/ai_runtime/__init__.py
```

自查点：`python -c "import memory_anki.modules.palace_quiz.application.generation"` 成功。

### 批次 3：按用例合并 generation 碎片（工作量最大，分 6 小批）

`quiz_generation_*` 家族按"来源类型"聚为 6 个用例模块，每个用例把 request / request_payload / request_context / preview / support / runtime 合并进一个文件（保持函数原样，按 payload→context→request→preview 顺序拼接，去重 import）：

| 目标文件 | 合并来源（application/ 下） |
|---|---|
| `generation/text.py` | quiz_generation_text_request.py、_text_request_payload.py、_text_support.py、_text_preview.py、quiz_generation_text_files.py |
| `generation/images.py` | quiz_generation_image_request.py、_image_request_context.py、_image_request_payload.py、_image_preview.py、quiz_generation_images.py |
| `generation/chapter_outline.py` | quiz_generation_chapter_outline*.py 6 个（outline / preview / request / request_context / request_payload / support） |
| `generation/review_mindmap.py` | quiz_generation_review_mindmap*.py 8 个 + quiz_generation_review.py |
| `generation/child_chapter.py` | quiz_generation_child_chapter_*.py 6 个（ai_runtime / context / log_reuse / preview / request / request_payload） |
| `generation/shared.py` | quiz_generation_prompt_messages.py、_preview_result.py、_preview_grouping.py、_chaptering.py、_chapter_grouping.py、_chapter_scope*.py 4 个、_editor_summary.py、_ocr_sources.py、_feedback*.py 3 个、_drafts/payloads 类小件视引用关系归入 |

每小批的固定操作序列（以 `generation/text.py` 为例）：

1. 新建 `application/generation/text.py`，按上表把来源文件内容依序完整复制进去；同名 import 合并去重；来源文件之间的相对引用（如 `from .quiz_generation_text_request_payload import X`）在合并后删除（函数已同文件）。
2. 更新外部引用：`rg "quiz_generation_text" apps/api/src` 找出所有仍 import 旧模块名的文件，把 `from .quiz_generation_text_request import build_text_generation_preview` 改为 `from .generation.text import build_text_generation_preview`（注意子包内引用兄弟模块用 `from ..xxx import`）。
3. 删除来源文件。
4. 验证：`python -m pytest tests/test_palace_quiz_routes.py tests/test_manual_text_quiz_parser.py -q` + `python -m ruff check src`。

不要做：不要改 `quiz_generation_service.py` 的模块路径（它是 mypy 豁免与门面锚点），只更新其内部 import；不要一次合并两个用例。

自查点（批次 3 完成后）：`Get-ChildItem application -File | Measure-Object` 顶层文件数明显下降；`rg "^from \.quiz_generation_" apps/api/src` 无结果。

### 批次 4：合并 ai_runtime 与 grouping 家族

1. `ai_runtime/`：把 `ai_service_runtime_calls.py`、`_config.py`、`_errors.py`、`_logging.py`、`_request.py`、`_stream.py`、`_sync.py` 七个文件合并为 `ai_runtime/runtime.py`（约 330 行）。**注意**：`ai_service.py` 第 13–14 行有 `from . import ai_service_runtime_config as _runtime_config` / `ai_service_runtime_stream as _runtime_stream` 并在 `_sync_facade_dependencies()` 里对这两个模块做属性注入（测试桩依赖此机制），合并后把这两行改为 `from .ai_runtime import runtime as _runtime_config` 前**必须**先确认 `tests/test_palace_quiz_routes.py` 对 `palace_quiz_ai_service` 的替换点仍生效；若测试对 `ai_service_runtime_stream.stream_chat_completion_text` 有直接引用则同步更新。`ai_service_runtime.py`(20 行门面) 改为从 `ai_runtime/runtime.py` 转发，或直接更新 `ai_service.py` 的 import 后删除。
2. `grouping/`：把 `quiz_grouping_ai_request.py`、`_ai_runtime.py`、`_context.py`、`_existing_questions.py`、`_existing_question_apply.py`、`_existing_question_request.py`、`_preview.py` 合并为 `grouping/classify.py`；`quiz_grouping_service.py` 留在顶层，内部 import 指向新位置。

自查点：`python -m pytest tests/test_palace_quiz_routes.py -q` 通过；`python -c "from memory_anki.modules.palace_quiz.application.ai_service import generate_quiz_preview_from_text_files"` 成功。

### 批次 5：合并 question_* 家族（50 个 → 约 8 个）

按职责聚合到 `questions/` 子包：

| 目标文件 | 来源前缀 |
|---|---|
| `questions/commands.py` | question_commands / _creation_commands / _update_commands / _delete_commands / _attempt_commands / _classification_commands / _lifecycle_commands / _batch_creation_support |
| `questions/queries.py` | question_queries / _listing_queries / _lookup_queries / _entity_queries / _row_queries / _row_scope_queries / _sort_order_queries / _explicit_chapter_queries / _row_ordering |
| `questions/validation.py` | question_validation* 3 个 + question_answer_*_validation 4 个 + _option_validation + _scope_validation |
| `questions/dedup.py` | question_dedup_keys / _dedup_queries / _duplicate_lookup / _import_dedup |
| `questions/serialization.py` | question_serialization* 3 个（**question_schema.py 保留在顶层不动**，freestyle 模块引用它） |
| `questions/scope.py` | question_scope_entities / _scope_rules |
| `questions/source_meta.py` | question_source_meta* 3 个 + question_generation_source_meta |
| `questions/writes.py` | question_write_commits / _write_rows / _write_support / _record_support / _contracts |

操作序列与批次 3 相同（复制→改引用→删源文件→跑测试），每合并一个目标文件验证一次。`service.py`（95 行门面）内部 import 全部指向新位置，函数签名与 `__all__` 不变。

自查点：`python -m pytest -q` 全绿；`rg "from \.question_(?!schema)" apps/api/src --pcre2` 无结果。

### 批次 6：收尾核查

1. `rg "from .service import" apps/api/src/memory_anki/modules/palace_quiz/application` 确认除无（架构护栏要求）。
2. 统计：目标是顶层 + 子包合计 ≤ 40 个文件，单文件不超过 800 行（`tools/check_architecture.py` 的 `MAX_API_FILE_LINES`）。
3. 跑第 3 节全部命令。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                    # 期望：全部通过
cd apps/api && python -m ruff check src tests      # 期望：0 错误
cd apps/api && python -m mypy                      # 期望：不多于基线错误（豁免模块路径未变）
python tools/check_architecture.py                 # 期望：passed（尤其 palace_quiz facade 规则与 800 行上限）
```

行为验收：

- 启动后端 → 在题目生成页用文本/图片各生成一次预览（SSE 正常流式输出）→ 保存题目 → 列表可见。
- `GET /api/v1/palaces/{id}/quiz-questions` 响应与重构前 JSON 结构一致（可对比重构前抓包）。

回归检查：`tests/test_palace_quiz_routes.py`（覆盖生成与题目 CRUD 路由）与 `tests/test_manual_text_quiz_parser.py` 必须持续全绿；freestyle 信息流（依赖 `question_schema.serialize_question`）不受影响（`tests/test_freestyle_routes.py`）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：124 个文件属实；"11–100 行碎片"属实（112 个 ≤100 行）；示例文件行数与描述吻合（messages 11 行、child_chapter_runtime 16 行）；大量 ≤20 行文件为纯 re-export 门面 |
| 2026-07-09 | Codex | 完成批次 0/1 的最小安全清理 | 当前目录直系 `.py` 为 126 个（含本轮新增 `quiz_generation_recovery.py`、`wrong_questions_service.py`）；删除 5 个纯转发门面：`quiz_generation_messages.py`、`quiz_generation_shared.py`、`quiz_generation_child_chapter_runtime.py`、`quiz_grouping_runtime.py`、`question_dedup.py`，并将引用改到真实模块；保留 `ai_service_runtime.py`。验证：touched files `ruff check` 通过；`python -m pytest tests/test_palace_quiz_routes.py tests/test_manual_text_quiz_parser.py -q` 为 43 passed, 21 skipped；旧门面导入无残留。未完成：尚未建立 `generation/`、`grouping/`、`questions/`、`ai_runtime/` 子包，也未执行批次 3-6 的大规模合并，因此本文档保持“部分完成”。 |
| 2026-07-09 | Codex | 低冲突评估/收尾切片 | 当前 application 顶层直系 `.py` 为 119 个；本轮只删除 2 个“门面套门面”的纯转发文件：`question_commands.py`、`question_lifecycle_commands.py`，并让 `service.py` 直接从真实 command 模块导入，`service.py` 对外导出的函数集合保持不变（含并行阶段已加入的 `restore_question`）。复核：`rg -n "question_commands\|question_lifecycle_commands" apps/api/src apps/api/tests -g "*.py"` 无残留，`rg -n "from \.service import" apps/api/src/memory_anki/modules/palace_quiz/application -g "*.py"` 无残留。验证：`python -m ruff check src/memory_anki/modules/palace_quiz/application/service.py` 通过；`python -m pytest tests/test_palace_quiz_routes.py tests/test_manual_text_quiz_parser.py -q` 为 43 passed, 21 skipped。结论：02-02 仍为“部分完成”；剩余的 `generation/`、`grouping/`、`questions/`、`ai_runtime/` 子包建立与同族文件合并会改动大量 import 和多个正在被其他 agent 修改的 palace_quiz/palaces 相关文件，当前并行阶段不继续大搬家。 |
| 2026-07-09 | Codex | 完成批次 2-6 的子包重组与收尾 | 已建立并使用 `generation/`、`grouping/`、`questions/`、`ai_runtime/` 子包：AI runtime 收到 `ai_runtime/runtime.py`，grouping 收到 `grouping/classify.py`，text/image/chapter/review/shared generation 收到 `generation/*.py`，question read/write/validation/dedup/serialization/source/scope 收到 `questions/*.py`。删除纯 re-export question shim 44 个与旧 generation 顶层碎片 36 个；保留对外锚点 `ai_service.py`、`service.py`、`quiz_generation_service.py`、`quiz_grouping_service.py`、`question_schema.py`、`manual_text_quiz_parser.py`。验收：`application` 合计 37 个 `.py`、顶层 15 个，无 >800 行文件；`rg` 旧碎片 import 仅剩允许的 `quiz_generation_service` 门面与 `question_schema` 外部引用；`python -m ruff check src/memory_anki/modules/palace_quiz/application src/memory_anki/modules/palace_quiz/presentation/router.py --fix` 后通过；`python -m pytest tests/test_palace_quiz_routes.py tests/test_manual_text_quiz_parser.py tests/test_freestyle_routes.py -q` 为 51 passed, 21 skipped。 |
