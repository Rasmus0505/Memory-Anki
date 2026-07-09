# Memory Anki PWA 运行说明

本文是项目根目录下唯一的当前 PWA 说明文档。`docx/移动端重构/`、`docx/移动端完善/` 等目录里的 PWA 文档是历史计划或交付记录，只用于追溯，不作为当前运行依据。

当前 PWA 的定位是：通过 Tailscale 私有网络访问本机运行的完整桌面端 Memory Anki。PWA 不再维护单独移动端应用；安装后打开的是同一套桌面端前端，默认进入 `/freestyle` 随心模式，仍可通过桌面导航访问完整功能。

## 访问方式

- 本机服务端口：`127.0.0.1:8012`
- 本机检查地址：`http://127.0.0.1:8012/freestyle`
- 手机安装地址：运行 `tools\configure-tailscale-pwa.bat` 后，使用脚本输出的 HTTPS Tailscale 地址并追加 `/freestyle`
- Tailscale Serve 转发：当前设备的 HTTPS 地址 -> `http://127.0.0.1:8012`

旧计划文档里出现的 `8000`、`100.94.*`、临时局域网地址、`/m` 或 `/mobile` 都属于历史记录。当前 PWA 默认入口是 `/freestyle`；旧 `/m`、`/mobile` 地址只作为兼容路径回退到随心模式。

## 本地运行原则

PWA 必须保持本地运行，使用本机服务和本机数据目录。PWA 默认会跳过百度云盘启动同步，避免开机自启时被同步锁或网络状态卡住。正常跨设备同步仍由桌面端 `start-desktop.bat` / `tools\stop.bat` 负责。

PWA 只通过 Tailscale Serve 在 tailnet 内私有访问，不做公网暴露，不要开启 Funnel。

## 日常使用

1. 电脑开机并确保 Tailscale 已连接。
2. 如果已安装自启，PWA 服务会随 Windows 登录自动启动；否则双击根目录的 `start-pwa.bat`。
3. 手机打开 Tailscale。
4. 用 Safari 或 Chrome 打开 `tools\configure-tailscale-pwa.bat` 输出的 HTTPS 地址，并访问 `/freestyle`。
5. 第一次打开后，使用浏览器菜单添加到主屏幕。

## 首次配置与启动

### 1. 启动 PWA 后端

在项目根目录双击或运行：

```powershell
.\start-pwa.bat
```

脚本会：

- 如果 `apps\web\dist` 不存在，会自动补一次构建；
- 启动 FastAPI 到 `127.0.0.1:8012`；
- 让后端同时服务 API 和已构建前端；
- 默认跳过百度网盘启动同步，避免 PWA 自启被同步锁卡住。桌面端 `start-desktop.bat` / `tools\stop.bat` 仍负责正常同步。

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

- `start-pwa.bat`：启动完整桌面端 PWA 后端，保持窗口/进程常驻，监听 `127.0.0.1:8012`。
- `update.bat`：停止相关进程，重建 `apps\web\dist`，并刷新启动所需状态。
- `tools\stop.bat`：停止桌面端和同端口残留进程。
- `tools\stop-pwa.bat`：停止占用 `8012` 的 PWA 后端。
- `tools\configure-tailscale-pwa.bat`：配置当前设备的 Tailscale Serve，将 HTTPS 转发到 `127.0.0.1:8012`。
- `tools\install-pwa-autostart.bat`：安装 Windows 登录自启快捷方式。
- `tools\uninstall-pwa-autostart.bat`：移除 Windows 登录自启快捷方式。
- `tools/pwa_launcher.ps1`：共享脚本入口，统一处理 Python/Node 探测、日志和自启快捷方式。
- `tools/pwa_server.py`：实际的 PWA 后端启动器。

## 何时运行 update.bat

会影响 `apps/web/dist` 的前端改动，先跑 `update.bat` 再打开 `start-pwa.bat`：

- `apps/web/src/**`
- `apps/web/public/**`
- `apps/web/index.html`
- `apps/web/vite.config.ts`
- `apps/web/package.json`
- `apps/web/package-lock.json`
- 任何前端构建输入、静态资源或 PWA 资源清单相关改动

只改这些一般不用 update，直接重启对应服务即可：

- `apps/api/src/**`
- `tools/dev_server.py`
- `tools/pwa_server.py`
- `tools/desktop_timer.py`
- 后端 API、数据库、同步、业务逻辑改动

判断口诀：只要改动会不会改变 `apps/web/dist`，会就 `update.bat`，不会就直接重启。

## 日志和检查

- 前端构建日志：`logs/pwa-build.log`
- PWA 后端日志：`logs/pwa-api.log`
- 隐藏自启日志：`logs/pwa-startup.log`
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

先运行更新，再重启 PWA 服务：

```powershell
.\update.bat
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

如果桌面端后端开发服务正在运行，它也可能占用 `8012`。PWA 和同端口后端服务不要同时争用 `8012`；Vite 前端开发端口仍按 `apps/web` 当前配置使用。
