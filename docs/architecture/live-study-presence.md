# 学习画面镜像（PWA / 电脑端）

手机 PWA 和 Electron 共用本机 FastAPI。跨 origin（Tailscale HTTPS vs `127.0.0.1`）不能用 `BroadcastChannel` 或 Electron IPC。当前学习画面活在进程内的 session live room 里，两端订阅同一份投影。

## 房间

- 传输：`GET /api/v1/session/live/stream`（fetch SSE + `X-Memory-Anki-Token`）和 `POST /api/v1/session/live/commands`
- 投影是进程内存，不写数据库，不进 Syncthing
- `view` 对 session 不透明；practice / quiz 各自编解码
- `client_id` 用于忽略自己的回声；`operation_id` 防重试
- Last-Write-Wins，单用户

## 时钟

只有 `controller_client_id` 对应的客户端累计前台秒数。跟随端渲染投影里的 timer，并本地插值。跟随端操作（翻卡、暂停）先接管控制器，再 hydrate 后继续累计。控制器断线超过宽限期则暂停 timer。

桌面浮窗仍通过 `desktopTimerBridge` 投影，不是第三套钟。

## 跟随

`surface !== idle` 且本机已在 `/freestyle`（或 `/`）时，跟随 `route`。设置/编辑页不强制跳转。

第一期表面是 `freestyle`。宫殿测验、导图复习、英语为后续表面。
