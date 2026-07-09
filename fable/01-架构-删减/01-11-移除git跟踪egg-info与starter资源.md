---
编号: 01-11
标题: 确认 git 不再跟踪 egg-info 与 Vite starter 资源（ralph/prd.json US-001），验证通过后回填 passes 标记
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

对应 `ralph/prd.json` 的用户故事 **US-001 "Remove tracked generated artifacts"**（第 6-19 行）：生成的包元数据（`memory_anki_api.egg-info`）与 Vite 脚手架自带的未使用资源（`hero.png`、`react.svg`、`vite.svg`）不应进入版本控制。该故事在 prd.json 中仍标记 `"passes": false`（第 17 行）。

经核实（2026-07-08），三条验收标准**当前均已满足**：

- `git ls-files apps/api/src/memory_anki_api.egg-info` 无输出（egg-info 未被跟踪，且当前磁盘上也不存在该目录）；
- `rg "hero.png|react.svg|vite.svg" apps/web/src apps/web/index.html` 无匹配；
- `.gitignore` 第 18 行已含 `*.egg-info/`。

因此本文档的工作是：把 US-001 的验收命令固化为可重复执行的检查、处理"另一台设备同步回旧状态"的回归可能，并在全部通过后把 prd.json 的 `passes` 回填为 `true`。

## 2. 详细执行清单

> 正常路径只修改 `ralph/prd.json` 一个文件。仅当步骤 1 的检查失败时才执行步骤 2 的补救动作。禁止用 `git rm` 删除 fable/ 或其他无关文件。

### 步骤 1：逐条执行 US-001 验收命令（复用 prd.json 第 11-14 行原文）

在仓库根目录 `D:\322321\Memory-Anki`（或另一台设备的仓库根）执行：

```
git ls-files apps/api/src/memory_anki_api.egg-info
```

期望：无输出。

```
git grep -n -I -e "hero.png" -e "react.svg" -e "vite.svg" -- apps/web/src index.html
```

期望：无匹配（退出码 1）。注：仓库根没有顶层 `index.html`（它在 `apps/web/index.html`），git grep 对不存在的 pathspec 可能报 "did not match any files"，此时补跑 `git grep -n -I -e "hero.png" -e "react.svg" -e "vite.svg" -- apps/web` 以覆盖前端全部跟踪文件，期望同样无匹配。

```
rg -n "egg-info" .gitignore
```

期望：命中 `*.egg-info/`（当前在第 18 行）。

最后跑一次前端类型检查（US-001 第 4 条验收 "Typecheck passes"）：

```
cd apps/web && npm run typecheck
```

期望：0 错误。

自查点：四项全部符合期望 → 跳过步骤 2，直接进入步骤 3。任何一项不符 → 执行步骤 2 对应分支。

### 步骤 2：仅在检查失败时执行的补救动作

2a. 若 `git ls-files` 列出了 egg-info 文件（例如另一台设备曾把它 add 进来又同步回来）：

```
git rm -r --cached apps/api/src/memory_anki_api.egg-info
```

只用 `--cached`（从索引移除、保留磁盘文件——本地 `pip install -e .` 会重新生成它，属于正常产物）。不要提交磁盘删除。

2b. 若 git grep 找到 `hero.png`/`react.svg`/`vite.svg` 引用：打开命中文件，删除对应的 import 与使用处（这些是 Vite starter 的装饰性资源，无业务功能）；若 `apps/web/src/assets/` 下存在这三个文件本体且已无引用，用 `git rm` 删除文件本体。

2c. 若 `.gitignore` 丢了 `*.egg-info/` 行：在 `.gitignore` 中补回一行 `*.egg-info/`。

自查点：重跑步骤 1 全部通过。

### 步骤 3：回填 prd.json 的 passes 标记

打开 `ralph/prd.json`，US-001 条目（第 6-19 行），修改前（节选）：

```json
      "priority": 1,
      "passes": false,
      "notes": ""
```

修改后：

```json
      "priority": 1,
      "passes": true,
      "notes": "Verified: egg-info untracked, no starter asset references, .gitignore covers *.egg-info/."
```

不要做的事：不要改 prd.json 中其他 user story 的任何字段；不要调整 JSON 缩进风格。

自查点：`python -c "import json;json.load(open('ralph/prd.json',encoding='utf-8'))"` 解析成功（JSON 未写坏）。

### 步骤 4：双设备防回归说明

egg-info 由 `pip install -e .`（CI 也这样装，见 `.github/workflows/ci.yml` 第 29 行）在本地生成，两台设备磁盘上出现 `apps/api/src/memory_anki_api.egg-info/` 目录是**正常现象**，`.gitignore` 的 `*.egg-info/` 会阻止其进入版本控制。只需确保任何人不使用 `git add -f` 强制添加。

## 3. 测试验收标准

可执行验证命令（在仓库根目录）：

| 命令 | 期望结果 |
|---|---|
| `git ls-files apps/api/src/memory_anki_api.egg-info` | 无输出 |
| `git grep -n -I -e "hero.png" -e "react.svg" -e "vite.svg" -- apps/web` | 无匹配 |
| `rg -n "egg-info" .gitignore` | 命中 `*.egg-info/` |
| `cd apps/web && npm run typecheck` | 通过 |
| `python -c "import json;json.load(open('ralph/prd.json',encoding='utf-8'))"` | 无异常 |

行为验收：

- 在装好开发环境的设备上执行 `cd apps/api && pip install -e .` 生成 egg-info → `git status` 不显示任何 egg-info 相关的未跟踪/已修改条目；
- 前端 `npm run build` → 构建成功，产物中无 starter 资源。

回归检查：不得误删 `apps/web` 中实际使用的静态资源（PWA 图标等）；`.gitignore` 其他条目保持不变。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建；核实结论：US-001 三条 git/rg 验收标准当前已全部满足（egg-info 未跟踪且磁盘不存在、无 starter 资源引用、.gitignore 第 18 行含 *.egg-info/），仅剩 prd.json passes 待回填 | 待执行（以步骤 1 现场复核为准） |
