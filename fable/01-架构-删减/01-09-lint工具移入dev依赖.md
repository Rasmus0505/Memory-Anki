---
编号: 01-09
标题: 把 ruff / mypy / import-linter 从运行时依赖 requirements.txt 移到 requirements-dev.txt
类型: 删减
范围: 架构
优先级: P2
预估工作量: S（<2h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker 24 / Codex复核
完成时间: 2026-07-09
---

# 01-09 ruff / mypy / import-linter 移到 dev 依赖

## 1. 原始需求

`apps/api/requirements.txt`（运行时依赖，共 15 行）的第 13-15 行混入了三个纯开发工具：

```
ruff==0.12.11
mypy==1.17.1
import-linter==2.3
```

而 `apps/api/requirements-dev.txt` 第 2-3 行的注释甚至明文承认了这个错位："Runtime + lint/type tooling stay in requirements.txt"。危害：运行时环境（`tools/pwa_launcher.ps1` 第 49 行提示用户 `pip install -r apps\api\requirements.txt` 装运行环境）被迫安装 lint/类型检查工具及其依赖树，拖慢双设备同步后的环境重建。CI 不受影响——`.github/workflows/ci.yml` 第 28 行安装的是 `requirements-dev.txt`，而它第 4 行 `-r requirements.txt` 会连带运行时依赖，移动后工具仍会被 CI 装上。

## 2. 详细执行清单

> 只修改 2 个文件：`apps/api/requirements.txt`、`apps/api/requirements-dev.txt`。不要改版本号（原样搬运），不要动 `.github/workflows/ci.yml`，不要动 `tools/pwa_launcher.ps1`。

### 步骤 1：从 requirements.txt 删除三行

打开 `apps/api/requirements.txt`，删除第 13-15 行，删除后全文应为：

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
jinja2==3.1.4
python-multipart==0.0.12
markdown==3.7
aiofiles==24.1.0
alembic==1.16.4
PyMuPDF==1.26.4
av==17.1.0
pydantic-settings>=2.0
python-dotenv>=1.0
```

自查点：`rg -n "ruff|mypy|import-linter" apps/api/requirements.txt` 无输出。

### 步骤 2：把三行加进 requirements-dev.txt 并更新注释

打开 `apps/api/requirements-dev.txt`，修改前（全文 7 行）：

```
# Development / test dependencies for apps/api.
# Runtime + lint/type tooling stay in requirements.txt; this file adds the
# test runner and HTTP client used by apps/api/tests (TestClient requires httpx).
-r requirements.txt

pytest==8.3.4
httpx==0.27.2
```

修改后：

```
# Development / test dependencies for apps/api.
# requirements.txt only holds runtime deps; this file adds lint/type tooling,
# the test runner and the HTTP client used by apps/api/tests (TestClient requires httpx).
-r requirements.txt

pytest==8.3.4
httpx==0.27.2
ruff==0.12.11
mypy==1.17.1
import-linter==2.3
```

注意版本号必须与从 requirements.txt 删除的完全相同（`ruff==0.12.11`、`mypy==1.17.1`、`import-linter==2.3`）。

自查点：`git diff` 显示三行从一个文件消失、在另一个文件出现，版本一致。

### 步骤 3：本地验证两种安装口径

```
python -m venv .tmp-rt && .tmp-rt\Scripts\pip install -r apps/api/requirements.txt
.tmp-rt\Scripts\pip show ruff
```

期望：`pip show ruff` 报 not found（运行时环境不再带 lint 工具）。然后：

```
python -m venv .tmp-dev && .tmp-dev\Scripts\pip install -r apps/api/requirements-dev.txt
.tmp-dev\Scripts\python -m ruff --version
.tmp-dev\Scripts\python -m mypy --version
.tmp-dev\Scripts\lint-imports --help
```

期望：三个工具均可用。验证完删除 `.tmp-rt`、`.tmp-dev` 两个临时目录（不要提交它们）。

自查点：两个临时 venv 的验证结果符合期望且已清理。

## 3. 测试验收标准

可执行验证命令：

| 命令 | 期望结果 |
|---|---|
| `rg -n "ruff|mypy|import-linter" apps/api/requirements.txt` | 无匹配（退出码 1） |
| `rg -n "ruff==0.12.11" apps/api/requirements-dev.txt` | 命中 1 行 |
| `cd apps/api && python -m pytest` | 全部通过（现有开发环境不受影响） |
| CI（push 后）Backend job | Install/pytest/ruff/mypy/lint-imports 步骤全绿 |

行为验收：

- 按 `tools/pwa_launcher.ps1` 第 49 行的提示只装 `requirements.txt` 的新环境 → 后端可正常启动服务（uvicorn + FastAPI 链路完整）；
- 该环境中 `python -m ruff` 不存在 → 符合预期（运行时不需要）。

回归检查：CI Backend job 的 "Run ruff"（ci.yml 第 35-37 行）、"Run mypy"（第 39-41 行）、"Check import boundaries"（第 43-45 行）三步必须仍能找到对应工具并通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建，已核实三个工具在 requirements.txt 第 13-15 行、CI 安装的是 requirements-dev.txt（含 -r requirements.txt）、启动器提示安装 requirements.txt | 待执行 |
| 2026-07-09 | fable Worker 24 | 将 `ruff==0.12.11`、`mypy==1.17.1`、`import-linter==2.3` 从 `apps/api/requirements.txt` 平移到 `apps/api/requirements-dev.txt`，并同步 dev 文件注释 | 已完成；`requirements.txt` 仅保留运行时依赖，`requirements-dev.txt` 继续 `-r requirements.txt` 并显式安装 lint/type/architecture 工具 |
| 2026-07-09 | Codex | 复核重复文档状态 | `rg -n "ruff|mypy|import-linter" apps/api/requirements.txt` 无匹配；`apps/api/requirements-dev.txt` 命中三项开发工具；本文档同步标记已完成 |
