---
编号: 04-06
标题: 收敛 dashscope_gateway.py 的 9 处 except Exception 为具体异常或带日志的受控降级
类型: 删减
范围: 功能
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 04-06 收敛 dashscope 网关宽泛异常捕获

## 1. 原始需求

`apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py` 共有 9 处 `except Exception`（已逐处核实行号，见下表）。其中大部分是"第三方 SDK 边界 → 转成领域错误 EnglishCourseError"的合理封装，但存在三类具体问题：① 静默吞异常无日志（第 521 行 `to_dict`）；② 域内错误被二次包装导致错误文案变形（第 466 行会把 try 块内自己抛出的 `EnglishCourseError("单句翻译结果为空。")` 再包一层变成"翻译句子失败：单句翻译结果为空。"）；③ 可以收窄却用了裸 Exception（第 194 行的 HTTP 下载、第 386/466 行的 LLM 调用——`call_chat_completion_text` 实际只抛 `OpenAICompatibleError` 族，见 `memory_anki/infrastructure/llm/openai_compatible.py` 第 23–51 行）。

9 处清单（行号以当前文件为准）：

| # | 行号 | 位置 | 现状 | 处理决策 |
|---|---|---|---|---|
| 1 | 87 | `Files.upload` | 转 EnglishCourseError | 保留宽捕获 + 补日志 |
| 2 | 105 | `Files.get` | 转 EnglishCourseError | 保留宽捕获 + 补日志 |
| 3 | 128 | `QwenTranscription.async_call` | 转 EnglishCourseError | 保留宽捕获 + 补日志 |
| 4 | 152 | `QwenTranscription.fetch` | 转 EnglishCourseError | 保留宽捕获 + 补日志 |
| 5 | 166 | `progress_callback(...)` | 吞掉 + logger.debug | 升级为 logger.warning |
| 6 | 194 | `requests.get` 下载转写结果 | 转 EnglishCourseError | 收窄为 `(requests.RequestException, ValueError)` |
| 7 | 386 | 批量翻译 `call_chat_completion_text` | 宽捕获 + isinstance 甄别重抛 | 拆成两个 except 分支 |
| 8 | 466 | 单句翻译 `call_chat_completion_text` | 宽捕获，会二次包装域内错误 | 拆分支，域内错误直接透传 |
| 9 | 521 | `to_dict` 里 `value.to_dict()` | `except Exception: pass` 静默 | 收窄 + debug 日志 |

决策依据：#1–#4 调用的 dashscope SDK 没有稳定公开的异常层级（不同版本抛 requests 异常、自定义异常甚至 KeyError 都有），强行收窄会漏；这里的宽捕获本身就是"受控降级"（转领域错误、消息带上下文），缺的只是日志。#6–#8 的下游异常类型是明确的，应收窄。

## 2. 详细执行清单

本文档所有修改都在同一个文件 `apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py`。

### 步骤 0：修改前的安全检查清单（必须先做）

```powershell
# 检查 1：确认恰好 9 处 except Exception
rg -n "except Exception" apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py
# 期望输出：87、105、128、152、166、194、386、466、521 共 9 行（行号允许 ±2 漂移，语义必须对应上表）

# 检查 2：确认 call_chat_completion_text 的异常族
rg -n "class OpenAICompatible|raise _build|raise OpenAICompatible" apps/api/src/memory_anki/infrastructure/llm/openai_compatible.py
# 期望输出：OpenAICompatibleError / ProtocolError / HttpError / NetworkError 定义，
# call/stream 只 raise 这三个子类

# 检查 3：记录改动前测试基线
cd apps/api && python -m pytest tests/test_english_routes.py -q
# 期望输出：全部通过（记录用例数）
```

### 步骤 1（#1–#4）：ASR 四处 SDK 调用补日志

四处做法相同，以第 85–88 行为例：

```python
# 修改前
try:
    upload_response = Files.upload(file_path=str(audio_path), purpose="inference")
except Exception as exc:
    raise EnglishCourseError(f"上传音频到转写服务失败：{exc}") from exc

# 修改后
try:
    upload_response = Files.upload(file_path=str(audio_path), purpose="inference")
except Exception as exc:
    logger.warning("english asr upload failed", exc_info=True)
    raise EnglishCourseError(f"上传音频到转写服务失败：{exc}") from exc
```

对 #2（105 行 `Files.get`）、#3（128 行 `async_call`）、#4（152 行 `fetch`）做同样处理，日志消息分别用 `"english asr file meta fetch failed"`、`"english asr task create failed"`、`"english asr task poll failed"`。

不要做什么：不要把这四处改成具体异常类型（dashscope SDK 无稳定异常层级）；不要改 `raise ... from exc` 的既有消息文案（前端与生成日志依赖这些文案）。

自查点：每处 except 分支恰好多出一行 `logger.warning(..., exc_info=True)`，其余不变。

### 步骤 2（#5）：进度回调日志升级

第 158–167 行：

```python
# 修改前
if progress_callback:
    try:
        progress_callback({...})
    except Exception:
        logger.debug("english asr progress callback failed", exc_info=True)

# 修改后（只改日志级别，回调失败仍不允许中断转写主流程）
if progress_callback:
    try:
        progress_callback({...})
    except Exception:
        logger.warning("english asr progress callback failed", exc_info=True)
```

自查点：该处仍然不 raise——回调失败中断整个 ASR 任务才是事故。

### 步骤 3（#6）：下载结果收窄异常类型

第 190–195 行：

```python
# 修改前
try:
    response = requests.get(transcription_url, timeout=60)
    response.raise_for_status()
    payload = response.json()
except Exception as exc:
    raise EnglishCourseError(f"下载字幕转写结果失败：{exc}") from exc

# 修改后（RequestException 覆盖网络/HTTP 错误；ValueError 覆盖 .json() 解析失败，
# requests.exceptions.JSONDecodeError 同时继承二者）
try:
    response = requests.get(transcription_url, timeout=60)
    response.raise_for_status()
    payload = response.json()
except (requests.RequestException, ValueError) as exc:
    logger.warning("english asr transcription download failed", exc_info=True)
    raise EnglishCourseError(f"下载字幕转写结果失败：{exc}") from exc
```

### 步骤 4（#7）：批量翻译拆 except 分支

第 356–395 行的 try 结构，把尾部改为：

```python
# 修改前
except Exception as exc:
    fail_external_ai_call_log(log_id, error_payload={"error": str(exc)})
    if isinstance(exc, EnglishTranslationBatchMismatchError):
        raise
    raise EnglishCourseError(f"翻译句子失败：{exc}") from exc

# 修改后（先窄后宽；Mismatch 用于上层自动拆小批重试，必须原样透传）
except EnglishTranslationBatchMismatchError as exc:
    fail_external_ai_call_log(log_id, error_payload={"error": str(exc)})
    raise
except (OpenAICompatibleError, EnglishCourseError) as exc:
    fail_external_ai_call_log(log_id, error_payload={"error": str(exc)})
    logger.warning("english batch translation failed", exc_info=True)
    raise EnglishCourseError(f"翻译句子失败：{exc}") from exc
```

同时在文件头部 import 区（第 27–30 行的 openai_compatible import 块）补：

```python
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    call_chat_completion_text,
)
```

不要做什么：不要删 `fail_external_ai_call_log` 调用——每个分支都必须先落 AI 调用失败日志再抛，这是外部 AI 调用审计链路。

### 步骤 5（#8）：单句翻译拆分支，修复二次包装

第 436–473 行的 try 结构尾部：

```python
# 修改前
except Exception as exc:
    fail_external_ai_call_log(log_id, error_payload={"error": str(exc)})
    raise EnglishCourseError(f"翻译句子失败：{exc}") from exc

# 修改后（try 块内第 446 行自己抛的 EnglishCourseError("单句翻译结果为空。")
# 不应再被包一层；LLM 基建错误才需要包装）
except EnglishCourseError as exc:
    fail_external_ai_call_log(log_id, error_payload={"error": str(exc)})
    raise
except OpenAICompatibleError as exc:
    fail_external_ai_call_log(log_id, error_payload={"error": str(exc)})
    logger.warning("english single translation failed", exc_info=True)
    raise EnglishCourseError(f"翻译句子失败：{exc}") from exc
```

### 步骤 6（#9）：to_dict 收窄并留痕

第 513–523 行：

```python
# 修改前
if hasattr(value, "to_dict"):
    try:
        parsed = value.to_dict()
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
return {}

# 修改后
if hasattr(value, "to_dict"):
    try:
        parsed = value.to_dict()
        if isinstance(parsed, dict):
            return parsed
    except (TypeError, ValueError, AttributeError):
        logger.debug("dashscope response to_dict failed", exc_info=True)
return {}
```

不要做什么（全文档级）：
- 不要动 `parse_translation_batch_response`、`resolve_dashscope_sdk_base_url`、`sanitize_url` 等纯函数。
- 不要动 `openai_compatible.py` 本身。
- 不要动同模块其它 gateway 文件里的异常处理（本文档只覆盖 dashscope_gateway.py）。

### 回滚方式

```powershell
# 未提交：
git checkout -- apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py
# 已提交：
git revert <提交 hash>
```

无数据结构变化、无 API 契约变化，回滚零风险。

## 3. 测试验收标准

可执行命令：

```powershell
cd apps/api
python -m pytest tests/test_english_routes.py -q   # 期望：与步骤 0 基线相同的全绿
python -m pytest -q                                # 期望：全部通过
ruff check src tests                               # 期望：0 error（注意未用 import 会被抓）
mypy                                               # 期望：0 error
```

行为验收（需配置好 DASHSCOPE_API_KEY 的设备）：

- 上传一段音频生成英语课程 → 转写、翻译全流程成功，生成日志（generation log）中各阶段事件齐全。
- 人为断网后触发课程生成 → 得到"上传音频到转写服务失败：…"领域错误提示，后端日志有对应 warning 记录，而不是裸 traceback 或静默。

回归检查：

- 批量翻译返回编号不匹配时，仍会自动拆小批重试（`EnglishTranslationBatchMismatchError` 透传链路不被破坏）——`tests/test_english_routes.py` 中相关用例必须通过。
- 外部 AI 调用日志（external_ai_call_logs）在成功/失败两个方向都照常落库。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | fable 文档代理 | 文档创建；逐处核实 9 个 except 的行号与语义，确认 call_chat_completion_text 异常族为 OpenAICompatibleError | 待执行 |
| 2026-07-09 | Codex | 核实实现与测试；确认 dashscope_gateway.py 已按 #1-#9 收敛：仅保留 ASR SDK/回调 5 处受控宽捕获，HTTP 下载、LLM 调用、to_dict 已收窄；确认 test_english_routes.py 覆盖单句空结果不二次包装与批量 mismatch fallback | 已完成；未改总索引 |
