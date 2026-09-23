---
feature: freestyle-progress-motion
status: delivered
updated: 2026-09-23
branch: perf/freestyle-load
commits: 2656ddb7..working-tree
---

# 随心进度条全场景动画（重做）

## Report

**What was built**

随心模式顶部进度条现在在所有状态变化点都有可感知的动画，且全部建立在几何变化（`scaleY` / 高度 / 光晕半径）之上，而不是只改亮度——这是上一轮"动画在跑但看不见"的根因（6px 高的 tick 上 `brightness` 0.85→1.25 只有约一档的亮度差）。播放头呼吸周期改为 1.6s（原 2.5s 会被读成静止），高度在 14px↔18.2px 之间循环并带动光晕扩张，实测位移 3.98px。评分脉冲把 tick 高度推到 1.9 倍并闪亮（420ms），宫殿全清时同宫殿各 tick 按 40ms 依次错开亮起（520ms）。重练节点插入为淡入+下落+缩放，欠账/今天分界线为竖向展开。

切卡动画按用户要求从"黑幕遮罩"改为**内容淡入上浮**（260ms，`opacity 0→1` + `translateY(10px)→0`），黑幕遮罩已删除——原实现用近黑遮罩覆盖卡片 320ms，感知上是"黑屏闪一下"而非入场，且随 `visualIndex` 在原生 scroll-snap 过程中切换，可能覆盖到滚动中的卡片。新增的内容包裹层位于卡片内部，实测不再遮挡顶部进度条。同时清掉了 `progressSegmentShapeClass` 在 viewing 时返回的静态 `shadow-[...]`，把光晕完全交给呼吸动画，避免两处 `box-shadow` 互相覆盖。

**Verification**

在 `apps/web` 下：

- `npm run typecheck` → PASS（exit 0）
- `npx eslint <3 个改动的 ts/tsx 文件> --max-warnings 0` → PASS（exit 0）
- `npx vitest run src/modules/practice/ui/freestyle` → PASS（38 文件 / 342 测试）
- `npm run build` → PASS
- `npm run test`（全量）→ 1760 通过 / 2 失败。两个失败（`feedConfig.test.ts` 的 "persists one stable unit encounter per card and clears it for a new round"；`ProfileBackupsPage.test.tsx` 的 "labels rolling and rescue backups and allows database restore"）已通过 `git stash` 暂存全部 4 个改动文件后重跑并确认**与本次改动无关**，标记为 PRE-EXISTING。
- `tools/check_architecture.py` → 失败于 3 个超大文件（`feedConfig.test.ts` 787 行、`round_state_service.py` 805 行、`round_plan.py` 849 行）。三者均未被本次改动触及，PRE-EXISTING。
- 全项目 `npm run lint` → 1 个 PRE-EXISTING error（`useImmersiveQueue.ts`）+ 1 个 warning（`PalaceMemoryLookupDialog.tsx`），均不在本次 diff 内。

浏览器实测（临时 harness，验证后已删除），用 `getComputedStyle` 与 `getBoundingClientRect` 采样：

- 呼吸：高度 14.13→18.11px（位移 3.98px），filter 出现 9 个不同中间值，1.6s 无限循环。
- 评分脉冲：`progress-tick-done` 触发，6px tick 峰值高度 17.95px（≈3 倍）。
- 宫殿全清：各 tick 的 `animation-delay` 依次为 0s / 0.04s / 0.08s / 0.12s，动画结束后无 class 残留。
- 切卡：内容 `opacity 0→1`、`translateY(10px)→0`，260ms 后稳定；前一卡正常摘掉 class，因此再次进入会重新触发；命中测试确认进度条不再被任何遮罩覆盖（`railVisible: true`）。
- `prefers-reduced-motion: reduce`：呼吸 `animation: none`、`filter: none`、高度恒定 14px（750ms 内位移 0.00px），不停歇也不闪烁。
- 播放头入场：实测过渡期间确实出现 `progress-rail-enter`，随后由 `progress-rail-breath` 接管。
- 重练节点作为播放头时：实测带动画（`progress-rail-breath`），不再是静态节点。

**独立审查与修复**

一次独立子代理审查（对 `[S2]` 契约逐行核对）判定 `APPROVE WITH FIXES` 并发现 3 个真实缺陷，均已修复并重新实测：

1. **`progress-rail-enter` 永远不会触发**（最严重）。触发 state 只在 `viewing` false→true 时置位，但 class 条件是 `playheadEnter && !viewing`，两者互斥，动画是死代码。修法：改为时间顺序——入场先播，结束后呼吸接管（`playheadEnter ? 'progress-rail-enter' : viewing ? 'progress-rail-breath' : null`），而不是用 `!viewing` 把两者做 class 互斥。入场 keyframe 补上 `scaleY`，避免与呼吸交接时高度突跳。
2. **宫殿全清定时器与动画时长不匹配**。JS 用 `560 + stagger*40` 清 class，CSS 是 `520ms + delay`，对 3 个 tick 以上的宫殿会把脉冲尾部截断。修法：抽出 `PALACE_DONE_MS` / `PALACE_STAGGER_MS` / `TICK_DONE_MS` / `RAIL_ENTER_MS` 常量并与 CSS 时长对齐。
3. **重练节点缺播放头动画**。两个 retry 分支都带了 `data-viewing` 却没有任何 class 响应它，因此重练轮里播放头落在重练卡上时是**完全静止**的（恰好是最常见路径）。修法：给 retry 节点同样接入播放头/脉冲 class，并让 `progressSegmentShapeClass` 按 `viewing` 取高度。

修复过程中另外自查出一个审查未列出的冲突：同一节点可能同时挂 `progress-tick-done` 与 `progress-palace-done`（一张卡既完成又刚好清空宫殿时），两者都写 `transform`+`filter`，后声明者会让前者变成死动画。已改为单一优先级选择：`palace-done` 优先于 `tick-done`（清空宫殿更罕见、更有意义），实测该节点不再双重挂载。

**Journey log**

- 上一轮的修复方向错了轴：把 `scaleY(1.04)`（6px 上仅 0.24px）换成 `brightness`，让动画"可测量"却仍"不可感知"。在 6px 量级的元素上，可感知性只能来自几何变化——这是本次的核心教训，也是规格里所有 keyframe 都以 `scaleY` 为主的原因。
- 上一轮会话中用户曾选"适度·轻呼吸光晕"，本轮明确改选"强烈、动感十足"。保守的幅度正是产出不可见动效的直接原因，故本轮一律以强动感为准。
- `brightness(1)` 会被 Lightning CSS 压缩成空参 `brightness()`。实测 Chrome 接受该形式并解析为 1（脉冲中间帧正常到达 `brightness(1.9)`），因此不构成缺陷；但审查时容易误判为"keyframe 损坏"，这里记录以免下次重复排查。
- 黑幕遮罩方案虽能触发动画，但语义错了：它盖住卡片制造"黑屏"而非"入场"。切卡动画应当作用于内容本身（位移+淡入），且不能覆盖顶部 rail。
- 本仓库 PowerShell 5.1 下 `&&` 是语法错误；用 `-replace` 批量改含中文注释的文件会破坏 UTF-8 字符，之后需用替换字符扫描复查。
