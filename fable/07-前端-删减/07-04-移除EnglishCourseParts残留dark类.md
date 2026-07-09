---
编号: 07-04
标题: 移除 EnglishCourseParts.tsx 中 3 处无效的 dark: 变体类
类型: 删减
范围: 前端
优先级: P2
预估工作量: S（<2h）
依赖文档: 无（与未来的 09-01 暗色模式文档相关，见正文说明）
状态: 已完成
负责代理: fable Worker 20
完成时间: 2026-07-09
---

## 1. 原始需求

项目没有暗色模式：Tailwind v4 CSS-first 配置下，`apps/web/src/index.css` 的 `@theme` 中没有定义 dark 变体的激活方式，全库也没有任何地方给 `<html>`/`<body>` 挂 `dark` class 或监听 `prefers-color-scheme` 切换主题。但 `apps/web/src/features/english/components/EnglishCourseParts.tsx` 有 3 处 `dark:` 类残留（已用 rg 全量核实，这是**全库仅有的 3 处** `dark:` 出现）：

- 第 111 行：`'text-gray-300 dark:text-gray-600'`
- 第 115 行：`'text-warning dark:text-warning/80'`
- 第 121 行：`'font-semibold text-gray-700 dark:text-gray-300'`

这些类在当前项目中永远不会生效，属于从别处复制粘贴带入的死代码，会误导后续维护者以为项目支持暗色模式。

与 09-01（暗色模式）的关系：**即使未来做暗色模式，也不应依赖这三处残留**——届时暗色适配应基于 `@theme` 语义色变量（如 `text-warning`、`text-muted-foreground`）整体重写，而不是零散的 `dark:text-gray-*` 硬编码灰阶。因此本删除与 09-01 不冲突，可先行执行。

## 2. 详细执行清单

> 不要做什么：不要改动这三个类所在字符串里 `dark:` 之外的任何类名（保留 `text-gray-300`、`text-warning`、`font-semibold text-gray-700` 原样）；不要动该文件其他行；不要顺手把 `text-gray-*` 换成语义色（那是另一个话题）。

1. 全量确认 `dark:` 仅存在于此文件：
   - 命令：`cd apps/web && rg -n "dark:" src`
   - 期望结果：只有 `src/features/english/components/EnglishCourseParts.tsx` 的 111、115、121 三行（若出现其他文件，把新增出现处一并按同样方式处理并在进度记录注明）。
2. 打开 `apps/web/src/features/english/components/EnglishCourseParts.tsx`，定位第 108-122 行的 `slotColor` 三元表达式，做三处字符串内删除：

   修改前：

   ```tsx
   const slotColor =
     slot.state === 'empty'
       ? 'text-gray-300 dark:text-gray-600'
       : slot.state === 'correct'
         ? 'text-success'
         : slot.state === 'revealed'
           ? 'text-warning dark:text-warning/80'
           : slot.state === 'wrong' && slot.extra
             ? 'text-destructive/70 line-through decoration-1'
             : slot.state === 'wrong'
               ? 'text-destructive'
               : slot.state === 'fixed'
                 ? 'font-semibold text-gray-700 dark:text-gray-300'
                 : 'text-gray-300'
   ```

   修改后：

   ```tsx
   const slotColor =
     slot.state === 'empty'
       ? 'text-gray-300'
       : slot.state === 'correct'
         ? 'text-success'
         : slot.state === 'revealed'
           ? 'text-warning'
           : slot.state === 'wrong' && slot.extra
             ? 'text-destructive/70 line-through decoration-1'
             : slot.state === 'wrong'
               ? 'text-destructive'
               : slot.state === 'fixed'
                 ? 'font-semibold text-gray-700'
                 : 'text-gray-300'
   ```

   - 自查点：diff 里只有三行变化，且每行只是删掉 `dark:xxx` 片段。
3. 最终安全检查：`cd apps/web && rg -n "dark:" src`
   - 期望结果：**空输出**。

## 3. 测试验收标准

- `cd apps/web && npm run typecheck && npm run test && npm run lint && npm run build` → 全部通过。
- 行为验收：
  - 打开 `/english`，进入任意一门课程（`/english/courses/{id}`），开始默写练习 → 未作答字母槽显示浅灰下划线占位、答对字母变绿（text-success）、点提示揭示的字母显示警示色、固定字母加粗深灰——与改动前完全一致（浅色模式下 `dark:` 类本来就不生效）。
- 回归检查：`EnglishCoursePage.test.tsx` 及 english 相关测试全绿；`rg -n "dark:" apps/web/src` 持续为空。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 22:30 | 文档撰写代理 | 文档创建 | 已核实全库 dark: 仅此 3 处（111/115/121 行）；与 09-01 关系已在正文注明 |
| 2026-07-09 | fable Worker 20 | 执行清理 | 已删除 EnglishCourseParts.tsx 三处无效 dark: 类；rg 自查 apps/web/src 已无 dark: |
