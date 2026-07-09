---
编号: 09-07
标题: PWA 更新提示 UI
类型: 新增
范围: 前端
优先级: P2
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 09-07 PWA 更新提示 UI

## 1. 原始需求

PWA service worker 更新后不应在用户活跃学习时强制刷新。目标是在 `controllerchange` 且用户已交互时弹出 toast，提供“立即刷新”操作。

## 2. 详细执行清单

1. 修改 `apps/web/src/pwa/registerServiceWorker.ts`。
2. 引入 `sonner` 的 `toast.info`。
3. 在 active-user no-auto-reload 分支显示“新版本已准备好”，操作按钮为“立即刷新”。
4. 保持非活跃场景自动 reload。

## 3. 测试验收标准

- `cd apps/web && npm exec vitest run src/pwa/registerServiceWorker.test.ts src/pwa/serviceWorkerContract.test.ts` 通过。
- 回归要求：`SKIP_WAITING`、`registration.update()`、`controllerchange` 逻辑保留。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 增加 PWA 更新 toast 与立即刷新动作 | 已完成 |
