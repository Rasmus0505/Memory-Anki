# 模块：search

## 状态
活跃 —— FSD 移除后的生产模块。

## 负责
全局搜索

## 公共入口
`public.ts` — 唯一的跨模块导入路径。

## 规则
- 不得导入其他模块的内部路径。
- 领域代码不依赖框架（不使用 React）。
- 工作流（XState）放在 application/workflows 下。
