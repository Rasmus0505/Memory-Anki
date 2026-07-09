---
编号: 01-11
标题: 移除 git 跟踪的 egg-info 生成物与 Vite starter 资源（承接 ralph/prd.json US-001，实测已基本达标，改为验证收口）
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-11 移除 git 跟踪的 egg-info 与 starter 资源

## 1. 原始需求

承接 `ralph/prd.json` 中 US-001 "Remove tracked generated artifacts"（第 6-19 行，`passes: false`）：
要求 git 不再跟踪 `apps/api/src/*.egg-info` 生成物、`apps/web` 中不再引用 Vite starter 资源
（`hero.png`/`react.svg`/`vite.svg`），且 `.gitignore` 含 `*.egg-info/`。

**2026-07-08 逐项实测，验收标准实际上已经全部满足**：

- `git ls-files | rg -i "egg-info"` → 无输出；`apps/api/src/` 下磁盘上也只有 `memory_anki/` 包目录，无 egg-info。
- `rg -n "hero.png|react.svg|vite.svg" apps/web`（含 `index.html`）→ 无匹配；`git ls-files apps/web` 中的
  svg 只有 `public/favicon.svg`、`public/icons.svg`、`public/pwa-icon.svg` 三个自有资源。
- `.gitignore` 第 18 行已含 `*.egg-info/`。

唯一未收口的是 `ralph/prd.json` 里 US-001 仍标记 `passes: false`、`notes` 为空，会误导后续按 PRD 执行的代理
重复排查。因此本文档改为：**执行完整验证 → 若发现回潮则按清单移除 → 更新 prd.json 状态收口**。
（egg-info 属于 `pip install -e .` 的本地生成物，在任一设备上都可能随时重新出现在磁盘上——这无妨，
`.gitignore` 已挡住；本文档管的是"git 跟踪"状态。）

## 2. 详细执行清单

### 步骤 1：验证 egg-info 未被 git 跟踪

```powershell
cd D:\322321\Memory-Anki
git ls-files | rg -i "egg-info"
```

- 期望：无输出（退出码 1）。
- **若有输出**（说明有人误提交了），执行移除——只解除跟踪、不删工作区文件：

```powershell
git rm -r --cached apps/api/src/memory_anki_api.egg-info
```

（路径以实际输出为准；`--cached` 必须带，否则会删掉本地 pip 元数据。）

- **自查点**：`git ls-files | rg -i "egg-info"` 无输出。

### 步骤 2：验证 .gitignore 含 `*.egg-info/`

打开仓库根 `.gitignore`，确认 Python 段存在以下行（当前在第 18 行）：

```text
*.egg-info/
```

- 已存在则**什么都不改**；不存在才在 `# ===== Python =====` 段补一行。
- 不要"顺手"调整 `.gitignore` 其他任何行。
- **自查点**：`rg -n "egg-info" .gitignore` 恰好 1 行。

### 步骤 3：验证 starter 资源引用已清零

```powershell
cd D:\322321\Memory-Anki
rg -n -i "hero\.png|react\.svg|vite\.svg" apps/web --glob "!node_modules"
git ls-files apps/web | rg -i "hero\.png|react\.svg|vite\.svg"
```

- 期望：两条都无输出。
- **若有输出**，逐条处理：
  - 引用出现在 `apps/web/src/**` 或 `apps/web/index.html` → 打开该文件删除对应 `<img>`/import 行
    （starter 装饰图无业务功能）；
  - 文件本体被跟踪（如 `apps/web/src/assets/react.svg`）→ `git rm apps/web/src/assets/react.svg`；
  - 删除引用后运行 `cd apps/web && npm run typecheck` 确认无悬空 import。
- 不要动 `apps/web/public/` 下的 `favicon.svg`、`icons.svg`、`pwa-icon.svg`——它们是本项目自有 PWA 资源。
- **自查点**：上述两条命令均无输出。

### 步骤 4：跑 US-001 的原始验收命令

按 `ralph/prd.json` US-001 `acceptanceCriteria` 原文逐条执行：

```powershell
cd D:\322321\Memory-Anki
git ls-files apps/api/src/memory_anki_api.egg-info     # 期望：无输出
git grep -n -I -e "hero.png" -e "react.svg" -e "vite.svg" -- apps/web/src index.html   # 期望：无输出（退出码 1）
rg -n "egg-info" .gitignore                             # 期望：命中 *.egg-info/
cd apps/web
npm run typecheck                                       # 期望：通过
```

注意：US-001 写的是 `index.html`（仓库根相对路径），实际文件在 `apps/web/index.html`；
`git grep -- apps/web/src index.html` 在仓库根找不到 `index.html` 时 git 会报
`fatal: ... did not match any files`——此时改用 `git grep -n -I -e "hero.png" -e "react.svg" -e "vite.svg" -- apps/web` 覆盖整个前端目录，结论等价。

- **自查点**：四条全部符合期望。

### 步骤 5：更新 ralph/prd.json 的 US-001 状态

打开 `D:\322321\Memory-Anki\ralph\prd.json`，把 US-001（第 6-19 行）的两个字段更新：

修改前：

```json
      "priority": 1,
      "passes": false,
      "notes": ""
```

修改后（日期写实际执行日）：

```json
      "priority": 1,
      "passes": true,
      "notes": "2026-XX-XX verified: no tracked egg-info, no starter asset references, .gitignore already has *.egg-info/ (line 18). See fable/01-架构-删减/01-11."
```

- 只改 US-001 这一个 story 的 `passes` 与 `notes`，其他 23 个 story 一律不动。
- **自查点**：`python -c "import json; d=json.load(open(r'ralph\prd.json', encoding='utf-8')); s=[u for u in d['userStories'] if u['id']=='US-001'][0]; print(s['passes'], s['notes'][:40])"` 输出 `True ...`。

### 步骤 6：全量回归

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run typecheck
cd ..\api
python -m pytest
```

### 明确不要做的事

1. 不要执行 US-002 的内容（check_architecture.py 增加 egg-info 拒绝规则等）——那是独立 story，不属本文档。
2. 不要删除磁盘上的 egg-info 目录本身（若存在）——那是 `pip install -e .` 的必要产物，只需保证 git 不跟踪。
3. 不要改 `apps/web/public/` 的任何自有资源与 `manifest.webmanifest`。
4. 不要改 `.gitattributes`、不要运行 `git push`（提交与否听项目主人安排，本文档不含提交步骤）。
5. 不要用 `git rm`（不带 `--cached`）处理 egg-info——会误删本地安装元数据。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `git ls-files \| rg -i "egg-info"` | 无输出 |
| `git grep -n -I -e "hero.png" -e "react.svg" -e "vite.svg" -- apps/web` | 无输出 |
| `rg -n "egg-info" .gitignore` | 命中 `*.egg-info/`（1 行） |
| `cd apps/web && npm run typecheck` | 通过 |
| `cd apps/api && python -m pytest` | 全部通过 |

### 行为验收（人工）

1. 在 `apps/api` 执行 `python -m pip install -e .` 使 egg-info 在磁盘重新生成 → `git status` 不显示任何
   egg-info 相关未跟踪/已修改条目（`.gitignore` 生效）。
2. 打开前端首页与 PWA 图标 → favicon/PWA 图标显示正常（自有 svg 未被误删）。
3. 打开 `ralph/prd.json` → US-001 `passes: true` 且 notes 说明了验证结论与本文档编号。

### 回归检查

- 前端构建（`cd apps/web && npm run build`）不因资源改动失败。
- PWA 清单（`public/manifest.webmanifest`）引用的图标路径全部有效。
- 其余 user story（US-002 ~ US-024）的 JSON 内容保持逐字节不变。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；**与任务描述不符**：实测 git 未跟踪任何 egg-info、apps/web 无 hero.png/react.svg/vite.svg 引用、.gitignore 已含 `*.egg-info/`（第 18 行），US-001 实质已达标；文档改为验证收口 + prd.json 状态更新 | - |
