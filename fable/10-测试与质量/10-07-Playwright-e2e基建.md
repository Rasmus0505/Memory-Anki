---
编号: 10-07
标题: Playwright e2e 基建
类型: 新增
范围: 测试与质量
优先级: P2
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 10-07 Playwright e2e 基建

## 1. 原始需求

前端缺少浏览器级 smoke e2e。目标增加 Playwright 依赖元数据、配置和基础用例，让 CI/干净安装环境可以运行 `npm run e2e`。

## 2. 详细执行清单

1. 修改 `apps/web/package.json`，增加 `@playwright/test`、`e2e`、`e2e:ui`。
2. 更新 `apps/web/package-lock.json`。
3. 新增 `apps/web/playwright.config.ts`，配置 preview webServer 与 chromium project。
4. 新增 `apps/web/e2e/app-smoke.spec.ts`，验证应用 shell 与主导航。

## 3. 测试验收标准

- `cd apps/web && npm run typecheck` 通过。
- 本机 `npm install --save-dev @playwright/test` 被 Electron `node_modules/electron/dist/resources/default_app.asar` 文件锁阻塞；依赖元数据已写入，解除占用后重新 `npm install` 即可落地 node_modules 并运行 `npm run e2e`。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 增加 Playwright 配置、脚本和 smoke 用例 | 已完成；本机安装受 Electron 文件锁限制 |
