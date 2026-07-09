---
编号: 01-09
标题: 将 ruff/mypy/import-linter 从 requirements.txt 移入 requirements-dev.txt
类型: 优化
范围: 架构
优先级: P2
预估工作量: S（<2h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-09 将 ruff/mypy/import-linter 移至开发依赖

## 1. 原始需求

`apps/api/requirements.txt`（15 行）目前混装运行时依赖与纯开发期工具：

```13:15:apps/api/requirements.txt
ruff==0.12.11
mypy==1.17.1
import-linter==2.3
```

这三个是 lint/类型/架构检查工具，服务运行时完全用不到。核实结论：

- 运行时代码零依赖：`rg -n "import ruff|import mypy|importlinter|import_linter" apps/api/src tools` 无匹配。
- 启动路径零依赖：`tools/pwa_launcher.ps1` 第 49 行仅提示用户
  `python -m pip install -r apps\api\requirements.txt` 安装**运行时**依赖；`tools/dev_server.py`、
  `tools/windows_runtime.ps1`、各 `start-*.bat` 均不调用这三个工具。
- CI 不受影响：`.github/workflows/ci.yml` 第 25-29 行安装的是 `requirements-dev.txt`，
  而 `requirements-dev.txt` 第 4 行 `-r requirements.txt` 级联包含运行时依赖；把工具移到 dev 文件后
  CI 的 `ruff check`/`mypy`/`lint-imports` 步骤（第 35-45 行）依然可用。
- `requirements-dev.txt` 第 1-3 行注释明确写着 "Runtime + lint/type tooling stay in requirements.txt"，
  是旧口径，需同步改掉。

收益：双设备部署/重装时运行时安装更快更小，职责边界清晰（requirements.txt = 跑服务所需，requirements-dev.txt = 开发所需）。

## 2. 详细执行清单

### 步骤 1：核实无运行时引用（执行时复查）

```powershell
cd D:\322321\Memory-Anki
rg -n "import ruff|import mypy|importlinter|import_linter|lint-imports" apps/api/src tools *.bat
rg -n "ruff|mypy|import-linter" tools/dev_server.py tools/pwa_launcher.ps1 tools/windows_runtime.ps1 tools/pwa_server.py
```

期望：第一条无匹配；第二条无匹配（或仅命中与安装无关的注释）。若发现启动脚本真的调用了这三个工具，
终止执行并记录到进度表。

### 步骤 2：修改 `apps/api/requirements.txt`

修改前（完整 15 行）：

```text
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
ruff==0.12.11
mypy==1.17.1
import-linter==2.3
```

修改后（删除最后三行，其余 12 行原样保留、顺序与版本号一字不改）：

```text
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

- **自查点**：`rg -n "ruff|mypy|import-linter" apps/api/requirements.txt` 无匹配。

### 步骤 3：修改 `apps/api/requirements-dev.txt`

修改前（完整 7 行）：

```text
# Development / test dependencies for apps/api.
# Runtime + lint/type tooling stay in requirements.txt; this file adds the
# test runner and HTTP client used by apps/api/tests (TestClient requires httpx).
-r requirements.txt

pytest==8.3.4
httpx==0.27.2
```

修改后（追加三个工具，**版本号从 requirements.txt 原样搬运，不要升级**；注释同步更新）：

```text
# Development / test dependencies for apps/api.
# Runtime deps live in requirements.txt; this file adds the test runner,
# HTTP client (TestClient requires httpx), and lint/type/architecture tooling.
-r requirements.txt

pytest==8.3.4
httpx==0.27.2
ruff==0.12.11
mypy==1.17.1
import-linter==2.3
```

- **自查点**：dev 文件同时包含 pytest、httpx、ruff、mypy、import-linter 五个条目且版本号与改前一致。

### 步骤 4：本地重装验证（开发环境）

```powershell
cd D:\322321\Memory-Anki\apps\api
python -m pip install -r requirements-dev.txt
python -m ruff check src tests
python -m mypy
lint-imports
python -m pytest
```

四个检查命令全部可执行且通过（证明工具仍装得上、配置仍生效）。

### 步骤 5：运行时纯净安装冒烟（可选，建议在另一设备同步后做一次）

在干净 venv 中只装运行时依赖并启动：

```powershell
python -m venv %TEMP%\ma-rt-venv
%TEMP%\ma-rt-venv\Scripts\python -m pip install -r apps\api\requirements.txt
%TEMP%\ma-rt-venv\Scripts\python -m pip install -e apps\api
%TEMP%\ma-rt-venv\Scripts\python -c "import memory_anki.app.main; print('ok')"
```

期望输出 `ok`——运行时导入不需要三个工具。验证后删除临时 venv。

### 明确不要做的事

1. 不要升级任何依赖版本（ruff 0.12.11 / mypy 1.17.1 / import-linter 2.3 原版本平移）。
2. 不要动 `pyproject.toml` 中 `[tool.ruff]`、`[tool.mypy]`、`[tool.importlinter]` 配置段——工具配置留在原处。
3. 不要改 `.github/workflows/ci.yml`——它已经安装 requirements-dev.txt，无需任何调整。
4. 不要动 `tools/pwa_launcher.ps1` 的提示文案——它指向 requirements.txt 恰好是正确的运行时口径。
5. 不要移动 pytest/httpx 或其他任何条目。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pip install -r requirements-dev.txt` | 安装成功 |
| `cd apps/api && python -m ruff check src tests` | 可执行且通过 |
| `cd apps/api && python -m mypy` | 可执行且与基线一致 |
| `cd apps/api && lint-imports` | 可执行且契约通过 |
| `cd apps/api && python -m pytest` | 全部通过 |
| `rg -n "ruff|mypy|import-linter" apps/api/requirements.txt` | 无匹配 |

### 行为验收（人工）

1. 按步骤 5 在干净 venv 只装 requirements.txt → 后端可 import、可启动服务并响应 `/api/v1/runtime-info`。
2. 推送后观察 GitHub Actions → Backend job 的 ruff/mypy/lint-imports 三个步骤全绿。

### 回归检查

- CI 全流程（tests → ruff → mypy → import boundaries → architecture check）不因依赖文件调整而失败。
- 双设备场景：另一台设备 `pip install -r requirements-dev.txt` 后开发工具链完整可用。
- PWA/桌面启动脚本（start-pwa.bat / start-desktop.bat / pwa_launcher.ps1）行为不变。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实三工具在 requirements.txt 第 13-15 行、CI 安装 dev 文件（级联 -r）、tools/ 与启动脚本无运行时依赖 | - |
