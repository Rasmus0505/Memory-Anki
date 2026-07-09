---
编号: 10-06
标题: shared/api/http.ts 测试补全
类型: 新增
范围: 前端
优先级: P1
预估工作量: S
依赖文档: 03-01
状态: 已完成
负责代理: fable Worker 12
完成时间: 2026-07-09 00:00
---

# 10-06 shared/api/http.ts 测试补全

## 1. 原始需求

`apps/web/src/shared/api/http.ts` 是前端统一 HTTP 入口，负责 JSON 请求、FormData 上传、失败请求入队、mutation id 注入与远程访问 API token header 注入。03-01 已在 `apps/web/src/shared/api/http.ts` 引入 `getApiToken()`，并新增 `apps/web/src/shared/api/apiToken.ts`，但缺少 focused Vitest 锁住 `X-Memory-Anki-Token` 与 `X-Memory-Anki-Mutation-ID` 的组合行为。

期望效果：补充窄单元测试，覆盖普通 `request()`、写请求 header 覆盖、`fetchWithMutationQueue()`、`uploadWithFormData()` 四条路径，避免后续改动破坏远程访问 token 注入或 FormData 上传 header 行为。

## 2. 详细执行清单

1. 新建 `apps/web/src/shared/api/http.test.ts`。
2. mock `@/shared/persistence/mutationQueue` 与 `@/shared/logs/model/appLogs`，让测试只聚焦 `http.ts` 对 fetch 参数和队列边界的调用。
3. 用 `setApiToken()` 写入测试 token，`vi.stubGlobal('fetch', fetchMock)` 捕获真实请求参数。
4. 覆盖以下断言：
   - GET `request('/palaces')` 会带 `Content-Type: application/json` 与 `X-Memory-Anki-Token`，但不会生成 mutation id。
   - POST `request()` 的显式 `X-Memory-Anki-Token` 与 `Content-Type` 优先于存储 token 和默认 JSON header，并会生成 mutation id。
   - `fetchWithMutationQueue()` 会保留调用方 header，补 token 与 mutation id，并在成功后按 coalesce key 清理队列。
   - `uploadWithFormData()` 会补 token 与 mutation id，但不设置 `Content-Type`，让浏览器保留 FormData boundary。

不要修改 `apps/web/src/app/router`、`apps/web/src/index.css`、`apps/web/src/shared/components/session/GlobalTimerProvider.tsx`，也不要改 `apps/web/src/shared/api/http.ts` 的生产逻辑。

自查点：`cd apps/web && npx vitest run src/shared/api/http.test.ts` 通过。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `cd apps/web && npx vitest run src/shared/api/http.test.ts` | `http.test.ts` 全部通过 |
| `cd apps/web && npm run typecheck` | TypeScript 检查通过，或仅暴露本任务外既有错误 |

行为验收：临时删除 `http.ts` 中 `X-Memory-Anki-Token` 注入逻辑，`http.test.ts` 中 token header 断言应失败；恢复后通过。

回归检查：FormData 上传路径仍不手动设置 `Content-Type`，避免破坏浏览器自动生成 multipart boundary。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | fable Worker 12 | 文档缺失时按任务 fallback 新建本文档，并补 `apps/web/src/shared/api/http.test.ts` | 覆盖 `request`、`fetchWithMutationQueue`、`uploadWithFormData` 的 token header 注入 |
