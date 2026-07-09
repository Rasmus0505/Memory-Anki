---
编号: 10-09
标题: 扩展 check_architecture.py 护栏
类型: 新增
范围: 架构
优先级: P2
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: fable Worker 22
完成时间: 2026-07-09
---

# 10-09 扩展 check_architecture.py 护栏

## 1. 原始需求

`tools/check_architecture.py` 已经承担前端层级、API 门面、后端模块边界、迁移安全和运行时数据等静态架构检查。随着前端 API 类型逐步从 `apps/web/src/shared/api/generated.ts` 收敛到 `apps/web/src/shared/api/contracts.ts` 与 owner API facade，生产代码如果重新直接导入 generated OpenAPI 文件，会绕过稳定契约层并扩大生成物变更的影响面。

本次首批护栏只做低风险静态检查：禁止前端生产代码直接导入 `@/shared/api/generated` 或相对路径指向的 `shared/api/generated`，允许 `shared/api/contracts.ts` 与 `shared/api/contracts/**` 作为稳定转接层，跳过测试文件。

## 2. 实际执行清单

1. 修改 `tools/check_architecture.py`：
   - 增加前端 import specifier 解析，覆盖 `import ... from`、动态 `import()` 与 side-effect `import/export`。
   - 新增 `check_frontend_generated_api_boundary()`，扫描 `apps/web/src/**/*.ts(x)`。
   - 禁止生产代码直接导入 `shared/api/generated`，错误提示要求使用 `@/shared/api/contracts` 或 owner API facade。
   - 保留 `apps/web/src/shared/api/generated.ts` 自身、`shared/api/contracts.ts`、`shared/api/contracts/**` 与前端测试文件豁免。
2. 新增 `tools/test_check_architecture.py`：
   - 用临时 `WEB_SRC` 覆盖 alias 直连与相对路径直连会报错。
   - 覆盖 contracts 包装层和测试文件不会报错。
3. 更新本文档与 `fable/00-总览/总索引与进度看板.md` 的 10-09 状态。

不要顺手修复 `python tools/check_architecture.py` 当前暴露的既有架构债务；本任务只保证新增护栏不引入新的 generated API 边界报错。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `python -m pytest tools/test_check_architecture.py` | 2 个工具测试通过 |
| `python -m ruff check tools/check_architecture.py tools/test_check_architecture.py` | 通过 |
| `python -m py_compile tools/check_architecture.py tools/test_check_architecture.py` | 通过 |
| `python tools/check_architecture.py` | 不出现 generated API 边界新报错；允许保留本任务外既有失败项 |

行为验收：在任意非测试前端生产文件临时加入 `import type { X } from '@/shared/api/generated'`，`python tools/check_architecture.py` 应报对应文件的 generated OpenAPI 直接导入错误；撤销临时代码后该错误消失。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | fable Worker 22 | 文档缺失时按任务 fallback 新建本文档；实现 generated API 边界护栏与工具测试 | `pytest`/`ruff`/`py_compile` 通过；全量架构检查仅剩本任务外既有失败项 |
| 2026-07-09 | Codex | 核实 10-09 收口状态 | `python -m pytest tools/test_check_architecture.py -q` 通过；`ruff`/`py_compile` 通过；`python tools/check_architecture.py` 未出现 generated API 边界报错，仍因本任务外既有债务失败 |
