# 点击驱动的跨设备计时边界

计时器属于 `modules/session`。应用壳层维护当前 dwell，页面和浮层只提供当前路由、标题和场景信息；计时状态由全局点击适配器和本地 interval ledger 负责。列表一行对应一个连续记录，区间详情保留其 route/scene 变化。

## 点击契约

全局使用 `document` capture 监听 `pointerdown`；不支持 `PointerEvent` 的环境使用 `mousedown`/`touchstart`，并做兼容去重。任意 route 的点击都有效，包括设置、备份和 timer overlay；route 过滤不决定是否计时。只有 active attachment 的 store 处理事件，避免多个 UI 实例重复写入。

- `idle` 的首击立即启动记录，并设置 `lastClick=now`。
- `running` 的每次点击先结算到 `min(now, lastClick + 300000)`。
- 两次点击间隔严格大于 **300000 ms（5 分钟）** 时，旧计时段在 effective seconds 和尾部 interval 上最多回退到恰好 5 分钟，记录 `pause`/`click_idle_timeout` 事件；当前点击立即作为新计时段起点，状态继续为 `running`。
- `paused` 或因 hidden/timeout 暂停后，首次点击恢复并从点击时刻建立新起点。
- `completed` 收到点击时创建新的记录。
- visibility 不会提前结束或自动暂停记录。隐藏超过 5 分钟由 ticker 或下一次点击结算回退；墙钟时间不会在恢复时追赶计入。

计时只记录点击驱动的活动区间。页面切换更新当前 scene/route，不额外创建一个独立计时器。每次 checkpoint、scene 切换、暂停或完成都可以闭合当前 interval；同一 session 的 growing checkpoint 允许产生多个区间行。

## 已确认 UTC interval ledger

前端只上传已经闭合且确认的 UTC interval。正在运行的区间、估算 checkpoint 秒数和未来结束时间不得上传。接口为 `POST /api/v1/study-sessions/time-ledger`，interval 使用稳定的 `interval_id`，重试可安全重复上传。服务端每次上传写入 immutable revision：

```text
学习数据/time-ledger/devices/{device_id}/revisions/{revision_id}.json
```

`device_id` 来自设备自己的 `local-config/memory-anki.local.json`，客户端不能覆盖；各设备拥有独立 UUID。Syncthing 只合并文件，不共享 SQLite 并发写。坏文件、非法 schema、非法 timestamp 或未来 created/ended 时间在读取时整文件跳过。

read model 按 `interval_id` 去重并计算 UTC 时间并集。相同 `session_id + started_at` 的 growing checkpoint 先按最长 `ended_at` 作为该组代表，再和其他 start/pause 区间做并集；跨设备重叠、重复 revision、短 checkpoint 和长 checkpoint 都不能重复增加 total。趋势按 UTC 日界线拆分跨午夜区间；kind/source breakdown 使用同一并集分配，所以分项合计不超过 total。

PATCH/DELETE 使用 `/study-sessions/time-ledger/{interval_id}`，列表行 ID 为 `ledger:{interval_id}`；修改和删除写新的 immutable correction/tombstone revision。对一个 growing group 的编辑或删除必须屏蔽同一 `session_id + started_at` 的旧短区间，防止同步后复活；后续 revision 仍受 terminal tombstone 约束。批量删除可同时接收 SQLite ID 和 `ledger:` ID。

列表 ledger 行提供兼容 StudySessionItem 的 `id`、`scene`、`title`、`status`、`started_at`、`ended_at`、`effective_seconds`、`events`、`progress`、`summary`；`summary` 至少包含 `client_source`、`device_id`、`session_id` 及上传 metadata。

## SQLite 兼容边界

ledger 是已确认 interval 的权威来源。旧 SQLite study session 记录只在没有任何 ledger row（包括已删除的 ledger tombstone）匹配其 `session_id` 时纳入 read model；canonical metadata 只用于兼容迁移和显示，不能抑制其他设备的 ledger，也不能让 deleted canonical 记录使 ledger fallback。前端 ledger-only persist 不应再为同一区间额外写等价 SQLite 记录。

analytics、时间列表、summary、kind/source breakdown 和 trend 都从同一个合并 read model 读取，保证统计口径一致。正式复习提交接口仍可产生自己的复习记录，但不得把同一 confirmed interval 再写成普通计时记录。

## 依赖边界

页面和 widgets 只能从 `modules/session/public.ts` 使用会话能力。全局 click、ticker、visibility 适配属于运行时层；UTC interval、union、revision、correction 和 tombstone 属于框架无关 domain/service。服务端负责 schema/timestamp 校验、immutable revision、group correction、terminal deletion 和旧 SQLite 兼容过滤。
