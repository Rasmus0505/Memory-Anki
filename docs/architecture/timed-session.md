# 可见页停留计时器边界

计时器属于 `modules/session`。应用壳层挂一条连续学习时段（dwell），页面只提供当前路由碎片。浮层是控制面的投影，不拥有会话。

## 单一 dwell 注册表

内存里只有一把连续钟，`sessionKey = dwell:live`。写入 API 时用 `dwell:{recordId}`，避免和下一时段撞 key。

- 除 `/profile*`、备份、`/timer-overlay` 外，任意页面停留都计入。
- 换页只追加 `sceneSegments`，不把列表拆成碎片行。
- 设置/备份页冻结时钟，不生成碎片，也不拆时段。
- 页面级 `useTimedSession` 只服务浮层/现场，`persistCompletionRecord=false`，避免双写。

列表一行是一次连续学习时段，标题形如 `09:12 学习时段`。碎片只出现在这条记录的详情里。

## 状态与时钟

状态只有 `idle`、`running`、`paused`、`completed`。`running` 在**页面可见**时走表，窗口失焦（旁边看资料）继续计。`visibilitychange=hidden`（切标签、进后台、息屏）暂停。

离开应用超过 **15 分钟** 再回来：完成旧记录，开一条新的。15 分钟内回来：同一 `recordId` 继续，后面的页面碎片追加进去。跨过 0 点不拆。

`pagehide` / `beforeunload` 只写检查点，不是停表。文档当时仍可见（PWA 切换、未真正离开的 `beforeunload`）必须立刻续上同一把钟，也不能把这次卸载当成 15 分钟挂起的起点；页面还在时，下一次卸载要能写上后来增加的秒数。浏览器解冻后，单次超过 5 秒的空隙不回补；此前按刻度已经记入的可见秒数保留。实时记录带 `client_source`，避免完成后落成「未知端」。

PWA 与电脑端同时打开时，live room 选出一个 `controller_client_id`。跟随端抑制本地区间（`liveClockOwnership`），只渲染投影秒数，避免双倍计时。详见 [live-study-presence.md](./live-study-presence.md)。

墙钟只用于界面刷新、隐藏时长和区间边界，不用于恢复时追赶离线时间。快照保存已结算的精确秒数与暂停原因；超过 15 分钟的挂起快照会落成终态，不会把后台时间补进 `effectiveSeconds`。这仍是 **foreground** 口径：只计可见页停留，不计后台。

进行中的停留钟大约每 30 秒，以及碎片切换或暂停时，写一条 `completion_method=saved` 的 `status=active` 检查点。时间列表、今日合计和趋势纳入最新一条仍在进行的停留检查点（`session_key` 以 `dwell:` 开头、秒数大于 0），并标成「进行中」；更早的 active 行不展示。终态仍是 `completed`。离开超过 15 分钟后，同一条记录改成 completed，不另开一行。不要先把 `left_page` 写成终态再续秒，后端会拒绝同优先级加时。

做题、关联题目、查看宫殿只改当前停留碎片的场景和标题，不另开计时器。设置页等不计时路由仍冻结这把钟。

## 写入契约

Study Session HTTP payload 使用以下版本字段：

| 字段 | 作用 |
| --- | --- |
| `session_key` | 连续时段身份 `dwell:{recordId}` |
| `client_revision` | 客户端单调版本，低版本或相同版本写入被忽略 |
| `operation_id` | 逻辑操作幂等键，重复请求返回已接受结果 |

`sceneSegments` 按页面/路由记录碎片。读模型按碎片累加标签时长；关键词可搜到碎片标题。`duration_edited=true` 只由历史记录编辑器显式设置。实时计时器永远提交观测到的可见秒数。正式复习仍由复习提交接口生成记录，不产生普通计时记录。非手工时长必须不超过开始到结束的服务器墙钟间隔。

## 依赖边界

页面和 widgets 只能从 `modules/session/public.ts` 使用会话能力。注册表和时间累计保持框架无关；浏览器可见性、卸载和本地快照属于运行时适配层。SessionPort 的服务端实现负责 revision/operation 幂等、终态保护和历史手工编辑例外。
