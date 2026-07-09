---
编号: 07-05
标题: 收敛 API 类型双轨制——删除空壳 generated.ts 与未接入的 openapi:types 脚本
类型: 删减
范围: 前端
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无（长期恢复 openapi 类型时与后端 03-03 response_model 文档联动）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 07-05 收敛 contracts 与 generated 双轨类型

## 1. 原始需求

前端 API 类型目前名义上有两条轨道，实际只有一条在用：

- **空壳轨**：`apps/web/src/shared/api/generated.ts` 仅 4 行（2 行注释 + `export {}`），注释声称"由 `npm run openapi:types` 生成、feature 代码应通过 wrapper 引用生成的契约"——但经全库 grep，**没有任何文件 import 它**，`package.json` 第 14 行的 `openapi:types` 脚本（`openapi-typescript http://127.0.0.1:8012/openapi.json -o src/shared/api/generated.ts`）也从未真正接入工作流。
- **真实轨**：`apps/web/src/shared/api/contracts/` 目录手写类型，共 14 个文件约 1555 行（palace.ts 287、profile.ts 225、quiz.ts 192、freestyle.ts 166、englishReading.ts 164、imports.ts 154、english.ts 80、dashboard.ts 77、review.ts 77、mindmap.ts 55、aiLogs.ts 32、runtime.ts 32、index.ts 13；**其中 knowledge.ts 只有 1 行 `export {}`，也是空壳**）。注：任务原描述"13 个文件 1700+ 行"与实测（14 个文件约 1555 行）略有出入，以实测为准。

空壳 generated.ts + 挂空脚本会误导后续代理："类型是生成的，改 contracts 没用/会被覆盖"。决策：**短期删除空壳与脚本**，消除误导；**长期**待后端按 `fable/03-架构-新增/03-03`（若该文档存在，编号以实际为准）给路由补全 response_model 后，再恢复 openapi 生成轨道并让 contracts 逐步迁移。

## 2. 详细执行清单

### 步骤 1：删除前安全检查

```powershell
cd D:\322321\Memory-Anki\apps\web
rg -n "from '@/shared/api/generated'|from './generated'|api/generated" src
rg -n "openapi" . -g "!node_modules" -g "!package-lock.json"
```

期望输出：

- 第 1 条为空（generated.ts 无任何 import 方）。
- 第 2 条只命中 2 个文件：`package.json`（第 14 行脚本 + 第 68 行 devDependencies 里的 `openapi-typescript`）和 `src/shared/api/generated.ts` 自身的注释。

若第 1 条出现了引用方，**停止执行**：说明生成轨道已被接入，本文档前提不成立。

- **自查点**：两条命令输出与期望一致。

### 步骤 2：删除 generated.ts

删除文件 `apps/web/src/shared/api/generated.ts`。

- 不要动同目录的 `contracts/`、`http.ts`、`queryClient.ts` 等其他文件。
- **自查点**：`npm run typecheck` 通过（本来就无人引用，必然通过）。

### 步骤 3：移除 package.json 中的 openapi:types 脚本与 openapi-typescript 依赖

JSON 不支持注释，"注释处理"采用**删除 + 在本文档记录恢复方式**的方案。

打开 `apps/web/package.json`：

修改前（scripts 块，第 7~16 行）：

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit",
    "openapi:types": "openapi-typescript http://127.0.0.1:8012/openapi.json -o src/shared/api/generated.ts",
    "desktop:timer": "electron ../desktop-timer/main.cjs"
  },
```

修改后（删除 openapi:types 一行，注意上一行行尾逗号）：

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit",
    "desktop:timer": "electron ../desktop-timer/main.cjs"
  },
```

然后卸载不再被任何脚本使用的 devDependency：

```powershell
cd D:\322321\Memory-Anki\apps\web
npm uninstall openapi-typescript
```

- 不要动 scripts 里的其他条目；不要顺手改任何依赖版本（依赖问题见 07-10）。
- **自查点**：`rg -n "openapi" package.json` 输出为空；`npm run dev` 可正常启动。

### 步骤 4：（可选，建议一并做）清理 contracts/knowledge.ts 空壳

`apps/web/src/shared/api/contracts/knowledge.ts` 只有 1 行 `export {}`，与 generated.ts 同性质。

4a. 安全检查：

```powershell
rg -n "contracts/knowledge" src
```

期望只命中 `contracts/index.ts` 第 3 行的 `export * from './knowledge'`。

4b. 删除 `apps/web/src/shared/api/contracts/knowledge.ts`，并删除 `contracts/index.ts` 第 3 行 `export * from './knowledge'`。

- `export * from` 一个空模块本身不报错，所以这步纯属去噪，若担心风险可跳过并在进度表注明。
- **自查点**：`npm run typecheck` 通过。

### 步骤 5：长期恢复路径（写给未来执行者，本次不执行）

将来接入 openapi 生成轨道时：

1. 先确认后端已按 fable 03 系列文档给 FastAPI 路由补全 `response_model`（否则生成的类型全是 `unknown`，没有价值）。
2. 恢复依赖与脚本：`npm install -D openapi-typescript`，在 scripts 加回 `"openapi:types": "openapi-typescript http://127.0.0.1:8012/openapi.json -o src/shared/api/generated.ts"`。
3. 启动后端（端口 8012）后运行 `npm run openapi:types`，再让 `contracts/*.ts` 逐文件改为从 generated.ts 派生/校验类型。

### 回滚方式

```powershell
cd D:\322321\Memory-Anki\apps\web
git checkout -- package.json package-lock.json src/shared/api
npm install
```

## 3. 测试验收标准

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run typecheck   # 期望：0 错误
npm run lint        # 期望：0 错误
npm run test        # 期望：全部通过（contracts 类型是纯 type，删除空壳不影响运行时）
npm run build       # 期望：构建成功
```

行为验收：

- `npm run dev` 启动 → 任意页面数据加载正常（类型层改动无运行时影响）。
- `npm run openapi:types` → 期望报 "missing script"（确认脚本已摘除，不会再有人误跑生成命令覆盖出一个新空壳）。

回归检查：`shared/api/contracts/index.ts` 其余 12 个 `export *` 不受影响；所有 `from '@/shared/api/contracts'` 的 import（全库大量使用）编译无错。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 实测 contracts 为 14 文件约 1555 行（与任务描述 13 文件 1700+ 行不符）；发现 knowledge.ts 也是空壳 |
| 2026-07-09 | Codex | 执行路线 A 并清理 knowledge 空壳 | 已确认前端源码无 `shared/api/generated` 消费方，`contracts/knowledge` 仅被桶导出引用；删除 `src/shared/api/generated.ts` 与 `contracts/knowledge.ts`，移除 `openapi:types` 脚本和 `openapi-typescript` devDependency，并在 `contracts/index.ts` 记录手写 contracts 为当前唯一事实来源。`npm uninstall openapi-typescript --save-dev` 因 Electron 文件锁 `default_app.asar` EBUSY 失败，改用等价 manifest/lockfile 精准删除。验证：`npm run typecheck`、`npm run build` 通过；`npm run openapi:types` 按预期报 missing script。 |
