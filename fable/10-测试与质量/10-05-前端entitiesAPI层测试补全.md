---
编号: 10-05
标题: 前端 entities API 层测试补全
类型: 新增
范围: 前端
优先级: P1
预估工作量: S
依赖文档: 10-06
状态: 已完成
负责代理: fable Worker 16
完成时间: 2026-07-09
---

# 10-05 前端 entities API 层测试补全

## 1. 原始需求

`apps/web/src/entities/**/api` 中多数模块是薄 API 封装，承担路径拼接、query 参数序列化、持久化重放元数据、预取缓存消费与事件广播等边界逻辑。此前只有导入流式接口有 focused Vitest，其他实体 API 改动缺少快速回归网。

本次执行范围保持窄切片：优先不改生产代码，只为一到两个 entity API 模块补单元测试。避开 `apps/web/src/shared/api/http.ts`、`apps/web/src/app/router`、`apps/web/src/shared/components/session/GlobalTimerProvider.tsx` 与 `apps/web/src/index.css`，避免与 10-06 和其他并行 worker 冲突。

## 2. 实际执行清单

1. 新增 `apps/web/src/entities/palace/api/catalogApi.test.ts`：
   - mock `@/shared/api/http`，断言列表查询的 query string 编码和附件 URL 拼接。
   - 覆盖 `prefetchPalacesGroupedApi` + `getPalacesGroupedApi` 的 warmup cache 消费行为。
   - 覆盖 `invalidatePalaceCatalogCache()` 会清理 warmed catalog promise 并广播 `palace-catalog:invalidated`。
   - 覆盖创建宫殿、专项卡标记、附件上传/删除的 persistence 元数据。
2. 新增 `apps/web/src/entities/ai-log/api/aiLogsApi.test.ts`：
   - 覆盖 `listAiCallLogsApi()` 对空值/null 的过滤与后端 query 参数名映射。
   - 覆盖无筛选条件时使用裸 `/ai-call-logs`。
   - 覆盖详情接口路径。
3. 未修改生产代码；未触碰 10-06 指定的 `shared/api/http.ts`。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `cd apps/web && npx vitest run src/entities/palace/api/catalogApi.test.ts src/entities/ai-log/api/aiLogsApi.test.ts` | 新增 focused tests 全部通过 |
| `cd apps/web && npm run typecheck` | TypeScript 检查通过，或仅暴露本任务外既有错误 |

行为验收：临时删除 `catalogApi.ts` 中 warmup cache 消费或 `aiLogsApi.ts` 中空值过滤时，对应测试应失败。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | fable Worker 16 | 文档缺失时按任务 fallback 新建本文档；补 `catalogApi` 与 `aiLogsApi` focused Vitest | 生产代码未改；覆盖 palace catalog API 边界与 AI log query 序列化 |
