# Memory Anki PWA 运行说明

本文是项目根目录下唯一的当前 PWA 说明文档。`docx/移动端重构/`、`docx/移动端完善/` 等目录里的 PWA 文档是历史计划或交付记录，只用于追溯，不作为当前运行依据。

当前 PWA 的定位是：通过 Tailscale 私有网络访问本机运行的完整桌面端 Memory Anki。PWA 不再维护单独移动端应用；安装后打开的是同一套桌面端前端，默认进入 `/freestyle` 沉浸随心刷卡（不是今日概览工作台；工作台在 `/today`），仍可通过桌面导航访问完整功能。

## 访问方式

- 本机服务端口：`127.0.0.1:8012`
- 本机检查地址：`http://127.0.0.1:8012/freestyle`
- 手机安装地址：运行 `tools\configure-tailscale-pwa.bat` 后，使用脚本输出的 HTTPS Tailscale 地址并追加 `/freestyle`
- Tailscale Serve 转发：当前设备的 HTTPS 地址 -> `http://127.0.0.1:8012`

旧计划文档里出现的 `8000`、`100.94.*`、临时局域网地址、`/m` 或 `/mobile` 都属于历史记录。当前 PWA 默认入口是 `/freestyle`；旧 `/m`、`/mobile` 地址只作为兼容路径回退到随心模式。

## 本地运行原则

PWA 必须保持本地运行，使用本机服务和本机数据目录。手机 PWA 与 Electron 桌面端共用 `127.0.0.1:8012` 的同一个后端、前端构建产物和数据库，不再启动两套服务。

当前数据库与运行时数据目录在 U 盘上：在 `local-config/memory-anki.local.json` 把 `local_app_home` 设为 `vol:MemoryAnki/memory anki data`（按卷标解析；U 盘卷标需为 `MemoryAnki`，目录名为 `memory anki data`）。启动前请插入 U 盘；盘符可随电脑变化，不必写死 `E:`。模板见 `local-config/memory-anki.local.example.json`。

PWA 默认会跳过百度云盘启动同步；桌面端启动时会短暂停止共享服务，完成拉取和迁移后重启，正常跨设备同步仍由 `start-desktop.bat` / `tools\stop.bat` 负责。

PWA 只通过 Tailscale Serve 在 tailnet 内私有访问，不做公网暴露，不要开启 Funnel。

## 日常使用

1. 电脑开机并确保 Tailscale 已连接。
2. 如果已安装自启，PWA 服务会随 Windows 登录自动启动；否则双击根目录的 `start-pwa.bat`。后端窗口会保持可见，便于直接查看启动和运行错误；不要关闭这个窗口。
3. 手机打开 Tailscale。
4. 用 Safari 或 Chrome 打开 `tools\configure-tailscale-pwa.bat` 输出的 HTTPS 地址，并访问 `/freestyle`。
5. 第一次打开后，使用浏览器菜单添加到主屏幕。

需要同时使用电脑和手机时，直接运行 `start-desktop.bat`。同步和迁移期间手机会短暂断开，随后 Electron 与手机 PWA 会共同使用恢复后的 `8012` 服务。关闭 Electron 窗口不会停止 PWA；需要停止服务并推送同步时运行 `tools\stop.bat`。

## 首次配置与启动

### 1. 启动 PWA 后端

在项目根目录双击或运行：

```powershell
.\start-pwa.bat
```

脚本会：

- 启动前自动执行指纹驱动的增量更新，按需完成同步、前端构建和数据库迁移；
- 如果 `127.0.0.1:8012` 已有健康的 Memory Anki 服务，会直接复用；否则启动 FastAPI；
- 让后端同时服务 API 和已构建前端；
- 当前 `sync_enabled=false`，启动不再访问百度网盘/MemoryAnki-Sync；数据只读 U 盘 `local_app_home`。

停止 PWA 后端：

```powershell
.\tools\stop-pwa.bat
```

### 2. 启用 Tailscale Serve

先到 Tailscale 管理后台确认：

- DNS 页面开启 `MagicDNS`；
- 开启 `HTTPS certificates`；
- 允许 `Serve`。

如果本机脚本提示：

```text
Serve is not enabled on your tailnet.
To enable, visit: ...
```

打开它给出的链接并确认启用即可。

然后右键以管理员身份运行：

```text
tools\configure-tailscale-pwa.bat
```

成功时脚本会显示当前设备自己的 HTTPS Tailscale Serve 地址，并显示它转发到 `127.0.0.1:8012`。手机访问时使用这个 HTTPS 地址加 `/freestyle`。

关闭 Tailscale Serve：

```powershell
tailscale serve --https=443 off
```

### 3. 安装 Windows 登录自启

运行：

```text
tools\install-pwa-autostart.bat
```

它会在当前 Windows 用户的启动文件夹写入 `Memory Anki PWA.lnk`。这是每台电脑自己的本地启动项，不会通过 git 或百度同步互相覆盖。

取消自启：

```text
tools\uninstall-pwa-autostart.bat
```

## 脚本说明

- `start-desktop.bat`：先执行智能增量更新，再同步并重启共享 `8012` 服务，让 Electron 与手机 PWA 共用该服务。
- `start-pwa.bat`：先执行智能增量更新，再启动或复用共享 `8012` 服务，并保留可见后端窗口。
- `tools\stop.bat`：停止 Electron、共享服务和开发前端，然后推送百度同步。
- `tools\stop-pwa.bat`：停止占用 `8012` 的 PWA 后端。
- `tools\configure-tailscale-pwa.bat`：配置当前设备的 Tailscale Serve，将 HTTPS 转发到 `127.0.0.1:8012`。
- `tools\install-pwa-autostart.bat`：安装 Windows 登录自启快捷方式。
- `tools\uninstall-pwa-autostart.bat`：移除 Windows 登录自启快捷方式。
- `tools/pwa_launcher.ps1`：共享脚本入口，统一处理 Python/Node 探测、日志和自启快捷方式。
- `tools/pwa_server.py`：实际的 PWA 后端启动器。
- `tools/pwa_tray.ps1`：为 Desktop 提供共享服务托盘菜单；PWA 的 BAT 与登录自启不再通过它隐藏后端。

两个启动入口都会先检查前端、后端和迁移指纹；无变化时立即继续启动，有变化时自动执行必要的停止、同步、构建和迁移。

日常 Electron 不再使用 `5173`。该端口仅保留给开发时手动运行 `cd apps/web && npm run dev`，并把 API 代理到共享的 `8012`。

Desktop 可继续使用后台托盘图标打开或停止共享服务；重复启动不会产生多个图标。手工运行 PWA 和登录自启均保留后端窗口，不再隐藏后端错误。托盘和错误提示使用“共享服务”描述，真实端口仅保留在技术日志、开发说明和浏览器地址栏中。

## 启动时自动更新

无需再单独运行更新脚本。`start-pwa.bat` 和 `start-desktop.bat` 都会先检查前端、后端与迁移输入：

- 完全无变化时保持服务状态并立即进入启动流程；
- 前端输入变化时按需刷新 `apps/web/dist`；
- 后端或迁移变化时按需停止共享服务、同步并准备数据库；
- 本机更新指纹保存在 `%LOCALAPPDATA%\MemoryAnki\update-state.json`，不会提交到 Git，也不会在两台电脑间互相覆盖。

## 日志和检查

- 前端构建日志：`logs/pwa-build.log`
- PWA 后端日志：`logs/pwa-api.log`
- PWA 启动日志：`logs/pwa-startup.log`
- 数据库准备日志：`logs/runtime-prepare.log`
- 数据库迁移日志：`logs/runtime-migrate.log`

启动后先在电脑上打开 `http://127.0.0.1:8012/freestyle` 检查本机服务，再在手机 Tailscale 环境里打开 HTTPS 地址。

## 常见问题

### 手机打不开页面

检查：

1. 电脑是否开机并连接 Tailscale。
2. 手机是否打开 Tailscale。
3. 电脑上 `start-pwa.bat` 是否正在运行。
4. 电脑浏览器能否打开 `http://127.0.0.1:8012/freestyle`。
5. `tools\configure-tailscale-pwa.bat` 是否已成功显示当前设备的 HTTPS Serve 地址和 `127.0.0.1:8012` 转发。

### 浏览器提示不是 PWA 或无法安装

PWA 安装需要 HTTPS。请用 Tailscale Serve 输出的 HTTPS 地址访问 `/freestyle`，不要用 `http://127.0.0.1:8012/freestyle` 在手机上安装。

### 更新后仍看到旧界面

直接重新运行 PWA 启动脚本，它会先自动更新：

```powershell
.\start-pwa.bat
```

如果手机主屏幕 PWA 仍加载旧缓存，进入“个人中心 -> 导入导出 -> PWA 更新”，点击“手动更新 PWA”。它会清理当前设备的 PWA 离线缓存和 Service Worker，然后重新进入 `/freestyle`，不会清除学习数据。

如果页面旧到看不到这个按钮，再打开当前设备的 HTTPS Tailscale 地址并访问 `/pwa-reset.html`，清理完成后重新进入 `/freestyle`。

### Serve 提示没有启用

打开脚本提示的 Tailscale 官方链接，启用 Serve/HTTPS。也可以到 Tailscale 管理后台确认 `MagicDNS` 和 `HTTPS certificates` 已开启。

### 端口 8012 被占用

运行：

```powershell
.\tools\stop.bat
.\start-pwa.bat
```

`start-desktop.bat` 与 `start-pwa.bat` 会通过跨进程锁协调，并复用同一个 Memory Anki 服务，无需错开启动。如果仍提示端口占用，说明 `8012` 被非 Memory Anki 程序占用；请先停止该程序。Vite 开发前端继续使用 `5173` 并代理到 `8012`。
