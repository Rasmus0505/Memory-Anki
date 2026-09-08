# 学习画面镜像（PWA / 电脑端）

手机 PWA 和 Electron 共用本机 FastAPI。跨 origin（Tailscale HTTPS vs `127.0.0.1`）不能用 `BroadcastChannel` 或 Electron IPC。当前学习画面活在进程内的 session live room 里，两端订阅同一份投影。

## 房间

- 传输：`GET /api/v1/session/live/stream`（fetch SSE + `X-Memory-Anki-Token`）和 `POST /api/v1/session/live/commands`
- 投影是进程内存，不写数据库，不进 Syncthing
- `view` 对 session 不透明；practice / quiz 各自编解码
- `client_id` 用于忽略自己的回声；`operation_id` 防重试
- Last-Write-Wins，单用户

## 时钟

计时控制是显式「接管计时」，不是谁发布画面谁当控制器。

- 命令类型：`publish`、`hello`、`take_control`、`heartbeat`。只有 `take_control=true` 或 `type=take_control` 才会成为控制器。只发布 `route` / `surface` / `view` 不能抢控制器。
- 投影记录当前控制权：`controller_client_id`、正在计时的 `controller_card_id`、最近 `controller_heartbeat_at`、租约到期 `controller_lease_expires_at`。
- 只有控制器客户端，且页面可见、窗口聚焦、当前 encounter 处于 open，才累计前台秒数。跟随端渲染投影里的 timer 并本地插值，不累计。
- 客户端时钟：`visibilitychange`（hidden）、blur、锁屏、隐藏、离开当前卡片时结算当前区间并暂停，绝不回填墙钟空隙。
- PWA 与电脑端：新控制器接管时旧控制器立即暂停并结算；旧端回来仍是跟随端，直到用户手动按「继续」接管。
- 心跳 lease / 租约 `CONTROLLER_LEASE_SECONDS = 8`：超时由服务端暂停 timer、清空控制器，不补断开期间的秒数。控制器退订仍走 `CONTROLLER_DISCONNECT_GRACE_SECONDS = 5` 宽限。
- 正式写入仍用 `session_key` + `client_revision` + `operation_id`。
- Live 投影仍是进程内存，不写数据库，经 SSE 推送。桌面浮窗仍走 `desktopTimerBridge`，不是第三套钟。

## 跟随

`surface !== idle` 且本机已在 `/freestyle`（或 `/`）时，跟随 `route`。设置/编辑页不强制跳转。

第一期表面是 `freestyle`。宫殿测验、导图复习、英语为后续表面。
