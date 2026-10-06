# 学习进度 presence（PWA / 电脑端）

手机 PWA 和 Electron 共用本机 FastAPI。跨 origin（Tailscale HTTPS vs `127.0.0.1`）不能用 `BroadcastChannel` 或 Electron IPC。当前学习状态活在进程内的 session live room 里，两端订阅同一份投影；设备保留各自的路由、当前卡片和翻卡/reveal UI，只共享学习进度。

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

## 设备本地视图

设备不跟随远端 `route`，也不套用远端当前卡片、完成槽位、题目答案或 reveal map。每端保留自己的学习路线和视图状态；live room 仅作为跨设备学习进度、评分和必要轮次计划刷新的传输层。

第一期表面是 `freestyle`。宫殿测验、导图复习、英语为后续表面。

## 永久功能

PWA / 电脑端学习进度共享与 presence 是永久功能。设备本地视图取代强制画面镜像；后续功能改动不得删除 live room、SSE、进度接收/发布钩子，也不得把投影写入 SQLite。架构门禁 `check_live_study_presence` 锁住接线。

随心模式双击切换编辑/学习必须保留翻卡进度。空的或更弱的初始 reveal map 不得覆盖已有缓存或 live 投影。

## 水合与跟随重试

启动时 `POST /session/live/commands` 的 `hello` 立刻拉取投影并标已连接。SSE 只做后续推送，不作为唯一水合路径。超过约 2 秒没有 snapshot/update 则每秒再 hello。

`GET /session/live/stream` 必须走纯 ASGI 中间件，不得经 `BaseHTTPMiddleware` 把事件流缓冲到结束。

设备端不因远端 `currentCardId` seek，也不因远端 revealMap 或题目状态改变本地 UI。若远端 `roundId` 不同，客户端可请求轮次计划刷新；刷新完成后仍由本地路线和当前卡片决定显示内容。默认或更弱的 revealMap 不得覆盖远端发布的数据。

## 评分镜像

任意一端评分后，`FreestyleLiveView.rating`（`selectedRating` + 宫殿批 `settled`）必须镜像到另一端。跟随端只套用本地 encounter / 队列，不发第二个评分 POST。空 rating 不得覆盖远端已有评分。之后改评以最新 `operation_id` 覆盖日程。
