---
编号: 07-05
标题: 决策 API 类型双轨的收敛：删除 openapi 生成空壳承认手写（路线 A，推荐）或启用生成类型（路线 B）
类型: 删减
范围: 前端
优先级: P1
预估工作量: S（<2h，路线 A）/ L（路线 B，跨前后端）
依赖文档: 路线 B 依赖 fable 03-03（后端补 response_model）
状态: 未开始（决策类文档：执行前须先在"进度记录"登记选定路线）
负责代理: 无
完成时间: 无
---

## 1. 原始需求

前端 API 类型存在"双轨制"，其中一轨是空壳（已核实）：

- **生成轨（空壳）**：`apps/web/src/shared/api/generated.ts` 全文仅 5 行（3 行注释 + `export {}`），**全库 0 个文件 import 它**（`rg "from '@/shared/api/generated'"` 为空）。配套的生成脚本在 `apps/web/package.json` 第 14 行：`"openapi:types": "openapi-typescript http://127.0.0.1:8012/openapi.json -o src/shared/api/generated.ts"`，devDependencies 里为此装着 `openapi-typescript ^7.10.1`（第 68 行）。
- **手写轨（实际在用）**：`apps/web/src/shared/api/contracts/` 目录 14 个文件共 1615 行（palace.ts 288 行、profile.ts 227 行、quiz.ts 208 行等），经 `contracts/index.ts` 桶式导出，是全库唯一的 API 类型来源。

空壳文件的注释还在误导（"feature code should import generated contracts through typed wrappers"），描述的是一个从未落地的架构。留着这条死轨的代价：每个新人都要花时间搞清"generated 和 contracts 哪个是真的"，而且 `openapi:types` 一旦有人误跑，产物依赖后端此刻在 8012 端口运行，且生成结果无人消费。

## 决策对比与推荐

| 维度 | 路线 A：删除空壳，承认手写（推荐） | 路线 B：启用生成类型替换手写 |
|---|---|---|
| 前提 | 无 | 后端先按 fable 03-03 给 FastAPI 路由补全 `response_model`，否则生成出的类型全是 `unknown`/缺失 |
| 工作量 | S：删 1 个文件 + 1 个脚本 + 1 个 devDep | L：后端补注解 + 重新生成 + 把 1615 行手写类型逐模块替换并校对字段命名差异（后端 snake_case 与部分手写 camelCase，如 englishReading.ts 的 `generatedMaterials`） |
| 收益 | 立即消除双轨困惑，零风险 | 类型与后端永不漂移（长期收益大） |
| 可逆性 | 完全可逆：将来做路线 B 时把脚本一行加回来即可 | — |

**推荐路线 A**：当前后端 response_model 覆盖不全，路线 B 被 03-03 阻塞；而路线 A 是纯删除、完全可逆，符合 1.md"最小改动、删除要安全"。若 03-03 完成后想升级到生成类型，届时以新文档重启即可（重新加回脚本只需一行）。

## 2. 详细执行清单

### 路线 A（推荐）

> 不要做什么：不要动 `apps/web/src/shared/api/contracts/` 下任何文件；不要动 `shared/api/http.ts`；不要卸载 openapi-typescript 之外的任何依赖。

1. 安全检查一：确认 generated.ts 无消费方。
   - 命令：`cd apps/web && rg -n "shared/api/generated" src`
   - 期望结果：**空输出**（generated.ts 自身的注释不含此路径字符串；若有输出，逐个改为从 `@/shared/api/contracts` 导入后再继续）。
2. 安全检查二：确认 `openapi:types` 脚本无 CI/脚本引用。
   - 命令：`rg -n "openapi:types" .`（在仓库根目录执行，rg 默认忽略 node_modules）
   - 期望结果：仅 `apps/web/package.json` 一条。
3. 删除文件 `apps/web/src/shared/api/generated.ts`。
4. 打开 `apps/web/package.json`，删除第 14 行 `"openapi:types": "openapi-typescript http://127.0.0.1:8012/openapi.json -o src/shared/api/generated.ts",`。
5. 卸载生成器：`cd apps/web && npm uninstall openapi-typescript`
   - 自查点：`rg -n "openapi-typescript" apps/web/package.json` 为空。
6. 在 `apps/web/src/shared/api/contracts/index.ts` 文件顶部加一行说明注释（防止双轨复活时无人知道历史决策）：

   ```ts
   // 本目录是前端 API 类型的唯一事实来源（手写维护）。
   // 曾存在 openapi-typescript 生成轨（shared/api/generated.ts），已按 fable 07-05 决策移除；
   // 若要恢复生成轨，需先完成 fable 03-03（后端补 response_model）。
   ```

### 路线 B（仅当 03-03 已完成且负责人选 B）

1. 确认 fable 03-03 状态为"已完成"，后端所有对前端暴露的路由都有 `response_model`。
2. 启动后端于 8012 端口，运行 `cd apps/web && npm run openapi:types`，确认 `generated.ts` 生成出非空内容。
3. 按 `contracts/index.ts` 的 13 个模块逐个替换：每次只挑一个模块（建议从最小的 `aiLogs.ts`（32 行）开始），把该模块内的手写 interface 改为从 `generated.ts` 的 `components['schemas'][...]` 取别名导出，保持对外导出名不变，跑 `npm run typecheck` 后再做下一个模块。
4. 全部模块替换完后，`contracts/*` 退化为"生成类型的命名别名层"，手写字段定义清零。
5. 在 CI 或 pre-commit 中加"重新生成并 diff 为空"的漂移检查（可另立文档）。

## 3. 测试验收标准

- 路线 A：
  - `cd apps/web && npm run typecheck && npm run test && npm run lint && npm run build` → 全部通过（generated.ts 本无消费方，理论上零影响）。
  - `npm run openapi:types` → 报错 "Missing script"（证明脚本已删）。
  - 行为验收：抽查 `/palaces`、`/freestyle`、`/profile` 三页正常加载（类型层删除不应有任何运行时影响）。
- 路线 B：每替换一个模块跑一次上述四连命令；最终行为验收覆盖全部主要页面。
- 回归检查：`contracts/` 的对外导出名（如 `PalaceEditorMeta`、`PalaceQuizQuestion`）在两条路线中都不得改名。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 22:30 | 文档撰写代理 | 文档创建 | 已核实：generated.ts 5 行空壳、0 消费方；contracts 14 文件 1615 行；脚本仅 package.json 一处引用。**执行前先登记选定路线** |
