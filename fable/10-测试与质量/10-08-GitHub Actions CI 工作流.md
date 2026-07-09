---
编号: 10-08
标题: GitHub Actions CI 工作流
类型: 新增
范围: 测试与质量
优先级: P1
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: fable Worker 21
完成时间: 2026-07-09 00:00
---

# 10-08 GitHub Actions CI 工作流

## 1. 原始需求

仓库已有后端 `apps/api/pyproject.toml`、`apps/api/requirements-dev.txt` 与前端 `apps/web/package.json`，但 GitHub Actions 需要收敛到能在 Windows 环境稳定执行的最小质量门禁。后端声明 Python `>=3.12`，前端声明 `packageManager: npm@11.11.0`，因此 CI 固定 Python 3.12、Node 24，并显式安装 npm 11.11.0。

期望效果：在 pull request 和 `main` push 上自动运行后端测试与前端 typecheck/test，不引入应用代码改动，不把 OpenAPI 生成、完整构建、ruff、mypy/import-linter 等额外质量门禁塞进最小 CI。

## 2. 详细执行清单

1. 打开 `.github/workflows/ci.yml`。
2. 保留 `pull_request` 与 `main` push 触发。
3. 将 `backend` job 设置为 `windows-latest`，使用 `actions/setup-python@v5` 安装 Python 3.12。
4. 在 `apps/api` 下执行：
   - `python -m pip install -r requirements-dev.txt`
   - `python -m pip install -e .`
   - `pytest`
5. 将 `frontend` job 设置为 `windows-latest`，使用 `actions/setup-node@v4` 安装 Node 24。
6. 前端依赖安装前执行 `npm install --global npm@11.11.0`，匹配 `apps/web/package.json` 的 packageManager 声明。
7. 在 `apps/web` 下执行：
   - `npm ci --ignore-scripts`
   - `npm run typecheck`
   - `npm run test`

不要修改 `apps/api/**` 或 `apps/web/**` 应用代码；不要在本任务中加入推送、部署、PR 创建、OpenAPI 生成校验、lint/type-strict 质量门禁或端到端浏览器测试。

自查点：`.github/workflows/ci.yml` 只包含后端与前端两个 job，二者都运行在 `windows-latest`，且前端显式使用 npm 11.11.0。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `python -c "from pathlib import Path; import yaml; yaml.safe_load(Path('.github/workflows/ci.yml').read_text())"` | YAML 能被解析 |
| `cd apps/api && pytest` | 后端测试通过，或仅暴露本任务外既有问题 |
| `cd apps/web && npm ci --ignore-scripts` | 前端依赖能按 lockfile 安装，不执行 Electron 等桌面依赖脚本 |
| `cd apps/web && npm run typecheck` | TypeScript 检查通过，或仅暴露本任务外既有问题 |
| `cd apps/web && npm run test` | Vitest 测试通过，或仅暴露本任务外既有问题 |

行为验收：在 GitHub 创建 pull request 后，应出现 `Backend` 与 `Frontend` 两个 CI job；任一 job 失败时 PR 检查失败。

回归检查：CI 不应依赖本机绝对路径，不应启动本地桌面/PWA 服务，不应要求密钥或外部 AI 服务。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | fable Worker 21 | 新建 10-08 文档并收敛 `.github/workflows/ci.yml` | 最小 CI 覆盖 Windows 后端 pytest 与前端 typecheck/vitest |
| 2026-07-09 | Codex | 复核 `.github/workflows/ci.yml` 与本文档验收项 | YAML 可解析；workflow 仅包含 Backend/Frontend 两个 Windows job，命令与最小 CI 范围一致 |
