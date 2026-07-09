---
编号: 01-06
标题: 清除 knowledge 路由的 8 处 print 调试、DEBUG_LOG_PATH 落盘调试日志，并停止把完整 traceback 返回给客户端
类型: 删减
范围: 架构
优先级: P0
预估工作量: S（<2h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker 1
完成时间: 2026-07-09
---

# 01-06 清除 knowledge 路由调试代码与 traceback 泄露

## 1. 原始需求

`apps/api/src/memory_anki/modules/knowledge/presentation/router.py`（共 302 行）残留一次线上排障留下的调试脚手架，经核实（2026-07-08）：

- **8 处 `print(...[DEBUG]...)`**：第 139-144 行（多行 print）、165、206、221、226、252、259、264 行；
- **调试日志落盘**：第 30 行 `DEBUG_LOG_PATH = REPO_ROOT / "output" / "subject-editor-debug.log"`，第 157-164 行在异常时把 payload 键名和完整 traceback 追加写入该文件（往仓库目录写运行时数据，违反 AGENT.md"运行时数据位置一律经 `memory_anki.core.config` 派生"的约束）；
- **traceback 泄露给客户端**：3 个 `except Exception` 块把 `traceback.format_exc()` 原文放进 500 响应——第 166 行（`update_subject_editor`）、第 227 行（`create_chapter`）、第 265 行（`delete_chapter`），泄露服务器代码路径与内部结构。

期望：删除全部调试代码，异常改用标准 `logging` 记录（服务端仍能排障），客户端只收到通用错误信息。

## 2. 详细执行清单

> 只修改 `apps/api/src/memory_anki/modules/knowledge/presentation/router.py` 一个文件。不要动其他路由文件，不要改任何业务逻辑（提交/回滚/备份调用的顺序保持原样）。

### 步骤 1：引入 logger，删除调试基建

文件头部，修改前（第 1-8 行、第 30 行）：

```python
"""知识体系路由：学科 + 章节。"""
import traceback

from fastapi import APIRouter, Depends
...
from memory_anki.core.config import REPO_ROOT
...
router = APIRouter(tags=["knowledge"])
DEBUG_LOG_PATH = REPO_ROOT / "output" / "subject-editor-debug.log"
```

修改后：

```python
"""知识体系路由：学科 + 章节。"""
import logging

from fastapi import APIRouter, Depends
...
router = APIRouter(tags=["knowledge"])
logger = logging.getLogger(__name__)
```

要点：删除 `import traceback`（第 2 行）、删除 `from memory_anki.core.config import REPO_ROOT`（第 8 行，`REPO_ROOT` 在本文件仅被 `DEBUG_LOG_PATH` 使用，已核实）、删除第 30 行 `DEBUG_LOG_PATH` 定义。

自查点：`rg -n "traceback|REPO_ROOT|DEBUG_LOG_PATH" apps/api/src/memory_anki/modules/knowledge/presentation/router.py` 无输出。

### 步骤 2：清理 `update_subject_editor`（第 129-166 行）

2a. 删除第 136-144 行的 payload 探测与 print（`root = editor_doc.get(...)` 起到 `print(...)` 止的调试块。注意第 135 行 `editor_doc = data.get("editor_doc")` 若删除调试块后不再被使用，也一并删除——`save_subject_editor_state(s, subject, data)` 接收的是整个 `data`，已核实 `editor_doc` 变量仅用于调试输出）。

2b. 把最后的 `except Exception` 块，修改前（第 154-166 行）：

```python
    except Exception:
        s.rollback()
        tb = traceback.format_exc()
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with DEBUG_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(
                "[update_subject_editor FAIL]\n"
                f"subject_id={subject_id}\n"
                f"payload_keys={list(data.keys()) if isinstance(data, dict) else type(data).__name__}\n"
                f"traceback=\n{tb}\n"
            )
        print(f"[DEBUG] update_subject_editor FAIL: {tb}", flush=True)
        return JSONResponse(status_code=500, content={"error": tb})
```

修改后：

```python
    except Exception:
        s.rollback()
        logger.exception("update_subject_editor failed: subject_id=%s", subject_id)
        return JSONResponse(status_code=500, content={"error": "internal server error"})
```

注意保留其上方的 `except EditorStateConflictError` 分支（第 151-153 行）原样不动——409 冲突响应是正常业务语义。

### 步骤 3：清理 `create_chapter`（第 204-227 行）

- 删除第 206 行 `print(f"[DEBUG] create_chapter: ...")` 与第 221 行 `print(f"[DEBUG] create_chapter OK: ...")`；
- `except Exception` 块修改前（第 223-227 行）：

```python
    except Exception:
        s.rollback()
        tb = traceback.format_exc()
        print(f"[DEBUG] create_chapter FAIL: {tb}", flush=True)
        return JSONResponse(status_code=500, content={"error": tb})
```

修改后：

```python
    except Exception:
        s.rollback()
        logger.exception("create_chapter failed: subject_id=%s", subject_id)
        return JSONResponse(status_code=500, content={"error": "internal server error"})
```

### 步骤 4：清理 `delete_chapter`（第 250-265 行）

- 删除第 252 行与第 259 行的两处 print；
- `except Exception` 块同步骤 3 改法（日志消息用 `"delete_chapter failed: chapter_id=%s", chapter_id`，响应体同为 `{"error": "internal server error"}`）。

自查点（步骤 2-4 后）：`rg -n "print\(|format_exc" apps/api/src/memory_anki/modules/knowledge/presentation/router.py` 无输出。

### 步骤 5：清理历史落盘的调试日志文件（如存在）

检查 `<REPO_ROOT>/output/subject-editor-debug.log` 是否存在（2026-07-08 核实当前不存在）；若存在则删除该文件。若 `output/` 目录因此变空且该目录不被其他功能使用，可一并删除空目录。不要把此文件加进 .gitignore（源头已移除，无需掩盖）。

不要做的事：

- 不要改 4 个正常返回路径的响应结构（前端依赖 `{"error": "not found"}`、`chapter_json`、`{"ok": True}` 等形状）；
- 不要把 `except Exception` 改成向上抛出（保持"回滚 + 500 JSON"的现有行为形状）；
- 不要动 `maybe_create_rolling_backup(...)` 的调用位置。

## 3. 测试验收标准

可执行验证命令（在 `apps/api` 目录）：

| 命令 | 期望结果 |
|---|---|
| `rg -n "print\(" src/memory_anki/modules/knowledge` | 无匹配 |
| `rg -n "DEBUG_LOG_PATH|format_exc|import traceback" src/memory_anki/modules/knowledge` | 无匹配 |
| `python -m pytest` | 全部通过 |
| `python -m ruff check src tests` | 通过 |

行为验收（操作 → 期望现象）：

- 前端学科编辑器正常保存 → 200，响应结构不变，后端 stdout 无 `[DEBUG]` 输出；
- 创建/删除章节 → 正常返回，stdout 无 `[DEBUG]` 输出；
- 人为构造保存冲突（两个标签页并发改同一学科）→ 仍返回 409 和冲突 detail（`EditorStateConflictError` 分支未被破坏）；
- 人为制造一次内部异常（如临时改坏一行再恢复）→ 客户端收到 `{"error": "internal server error"}`，响应体中**不含**文件路径/堆栈；服务端日志中有完整 `logger.exception` 堆栈。

回归检查：学科树查询、章节 CRUD、宫殿-章节关联（`/palaces/{id}/chapters`）全部正常；滚动备份仍按原时机触发。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建，已核实 8 处 print 行号、DEBUG_LOG_PATH 与 3 处 traceback 泄露点；output/subject-editor-debug.log 当前不存在 | 待执行 |
| 2026-07-09 | fable Worker 1 | 删除 knowledge 路由调试 print、DEBUG_LOG_PATH、traceback 响应泄露，改为 logger.exception + 通用 500 JSON | 已完成；`rg` 复核 knowledge 范围无 `traceback/DEBUG_LOG_PATH/format_exc/import traceback/print(`；`output/subject-editor-debug.log` 不存在；`python -m ruff check src/memory_anki/modules/knowledge/presentation/router.py --select E,F,I,T20` 通过 |
