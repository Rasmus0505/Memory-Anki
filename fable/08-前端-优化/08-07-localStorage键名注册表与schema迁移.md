---
编号: 08-07
标题: localStorage 键名注册表与 schema 迁移
类型: 优化
范围: 前端
优先级: P1
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-07 localStorage 键名注册表与 schema 迁移

## 1. 原始需求

localStorage key 分散在多个模块中，迁移和清理缺少中心化登记。目标是新增 storage registry，并让偏好/计时相关存储走统一登记。

## 2. 详细执行清单

1. 新增 `apps/web/src/shared/persistence/storageRegistry.ts`。
2. 补 `apps/web/src/shared/persistence/storageRegistry.test.ts`。
3. 迁移 client preferences、persistent preference store、localStorage helper、计时自动化配置等调用点。

## 3. 测试验收标准

- `cd apps/web && npm run test -- src/shared/persistence/storageRegistry.test.ts src/shared/lib/localStorage.test.tsx src/shared/preferences/persistentPreferenceStore.test.ts` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 新增 storage registry 并迁移首批 key | 已完成 |
