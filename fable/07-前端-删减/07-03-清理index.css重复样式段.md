---
编号: 07-03
标题: 合并 index.css 中两处重复的按钮按压反馈与两套全局 hover/focus 过渡
类型: 删减
范围: 前端
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

## 1. 原始需求

`apps/web/src/index.css`（全文 1691 行）里有两代"全局交互反馈"样式共存（已逐行核实）：

- 早期一代：第 109-130 行的 `/* === GLOBAL CLICK FEEDBACK === */` 段，含按钮按压（112-115 行，`scale(0.97)`）、链接颜色过渡（118-120 行）、卡片 hover 过渡（123-125 行）、输入框 focus 过渡（128-130 行）。
- 后期一代：第 330-371 行的 `/* === GLOBAL DOPAMINE FEEDBACK LAYER === */` 段，用一个大选择器组（button/a[href]/input/textarea/select/summary/[role=…]/[data-feedback]，336-354 行）统一声明 transform/box-shadow/border-color/background-color/color 过渡，另有 hover 上浮（356-365 行）和按压（367-371 行，`translateY(1px) scale(0.975)`）。

重复点：**112-115 与 367-371 是两条同为 `button:active:not([disabled])` 起手的按压规则**（后者在层叠中胜出，前者只剩"按压瞬间把过渡覆盖为 0.1s"这一点残余效果）；**118-120 与 128-130 声明的过渡属性是 336-354 大选择器过渡的子集**（仅时长略有差异 0.15s vs 0.18-0.22s）。删掉早期一代可减少约 15 行冗余、消除"改了一处没生效"的排查成本。

## 2. 详细执行清单

> 不要做什么：不要动 123-125 行的 `.hover\:shadow-md:hover`（它作用于带 `hover:shadow-md` 的**任意元素**，包括不在 336 行选择器组里的卡片 div，删掉会让卡片阴影过渡消失）；不要动 330-371 行的 DOPAMINE 段；不要"顺手"调整任何颜色、时长数值；不要动 index.css 的其他任何段落。

1. 打开 `apps/web/src/index.css`，先核对以下两段与文档一致（若行号漂移，以内容为准搜索定位）：

   ```css
   /* 第 111-115 行（待删） */
   /* Button press effect */
   button:active:not([disabled]) {
     transform: scale(0.97);
     transition: transform 0.1s ease;
   }
   ```

   ```css
   /* 第 367-371 行（保留，不动） */
   button:active:not([disabled]),
   [role="button"]:active,
   [data-feedback]:active {
     transform: translateY(1px) scale(0.975);
   }
   ```

2. 删除第 111-115 行整块（含注释 `/* Button press effect */`）。
   - 效果说明：按压位移改由 367-371 行接管（`translateY(1px) scale(0.975)`，与现状一致，因为它本来就在层叠中胜出）；按压过渡时长从被覆盖的 0.1s 变为 336 行统一的 `transform 0.18s`，属可接受的近似（本次改动明确不追求像素级一致）。
   - 自查点：搜索 `scale(0.97)`，全文件应只剩 367-371 行那一处的 `scale(0.975)` 及动画 keyframes 里的值。
3. 删除第 117-120 行整块：

   ```css
   /* Link hover underline animation */
   a[class]:not([class*="no-underline"]) {
     transition: color 0.15s ease;
   }
   ```

   - 效果说明：`a[href]` 已在 336-354 行获得包含 color 在内的完整过渡（0.18s）。仅无 href 的 `<a class="…">` 会失去颜色过渡——这类元素不可交互，无实际影响。
4. 删除第 127-130 行整块：

   ```css
   /* Input focus glow */
   input:focus-visible, textarea:focus-visible, select:focus-visible {
     transition: box-shadow 0.15s ease, border-color 0.15s ease;
   }
   ```

   - 效果说明：input/textarea/select 已在 336-354 行声明了 `box-shadow 0.22s`、`border-color 0.18s` 过渡，聚焦发光仍有动画，只是时长略变。
5. 保留第 122-125 行 `.hover\:shadow-md:hover { ... }` 原样不动（理由见"不要做什么"）。
6. 安全检查（确认没有别的文件依赖被删规则的注释锚点或复制品）：
   - 命令：`cd apps/web && rg -n "Button press effect|Link hover underline|Input focus glow" src`
   - 期望结果：**空输出**（三块及其注释已全部删除，且无其他文件复制过这些段落）。
7. 跑一次 PWA 样式相关测试守卫：`cd apps/web && npx vitest run src/indexCss.pwa.test.ts`
   - 期望结果：通过（该测试只校验 index.css 的 PWA 相关段，不涉及本次删除区域；若失败说明误删了其他段落，回滚重来）。

## 3. 测试验收标准

- `cd apps/web && npm run typecheck && npm run test && npm run lint && npm run build` → 全部通过。
- 行为验收（人工，开 dev server 后逐项操作）：
  - 任意页面点击一个按钮并按住 → 按钮仍有下压缩小反馈（translateY(1px)+scale(0.975)），松开回弹；
  - 鼠标悬停侧边栏导航链接 → 颜色平滑过渡（无瞬跳）；
  - 点击任意输入框（如 `/palaces/list` 的搜索框）→ 聚焦时边框/阴影平滑出现；
  - 悬停带阴影的卡片（如 `/palaces` 书架卡片）→ 阴影过渡仍平滑。
- 回归检查：`.star-rating`（103-107 行）、`.memory-anki-session-glow-*`（192 行起）等相邻段落不得被波及；diff 应当只有三处删除、零处新增。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 22:30 | 文档撰写代理 | 文档创建 | 已核实行号与内容：112-115/367-371 按压重复，117-130 与 336-354 过渡重叠；123-125 需保留 |
