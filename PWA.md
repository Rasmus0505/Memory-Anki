# Memory Anki PWA 运行说明

本文是项目根目录下唯一的当前 PWA 说明文档。`docx/移动端重构/`、`docx/移动端完善/` 等目录里的 PWA 文档是历史计划或交付记录，只用于追溯，不作为当前运行依据。

当前 PWA 的定位是：通过 Tailscale 私有网络访问本机运行的完整桌面端 Memory Anki，作为云端不可用时仍能使用的本地兜底入口。PWA 不再维护单独移动端应用；安装后打开的是同一套桌面端前端，默认进入 `/freestyle` 随心模式，仍可通过桌面导航访问完整功能。

## 访问口径

- 本机服务端口：`127.0.0.1:8012`
- 本机检查地址：`http://127.0.0.1:8012/freestyle`
- 手机安装地址：`https://desktop-lp-2026481850.tail92e457.ts.net/freestyle`
- Tailscale Serve 转发：`https://desktop-lp-2026481850.tail92e457.ts.net` -> `http://127.0.0.1:8012`

旧计划文档里出现的 `8000`、`100.94.*`、临时局域网地址、`/m` 或 `/mobile` 都属于历史记录。当前 PWA 默认入口是 `/freestyle`；旧 `/m`、`/mobile` 地址只作为兼容路径回退到随心模式。

## 本地兜底原则

PWA 必须保持本地运行，不依赖云端数据库或云端 API。`tools/pwa_server.py` 会在 PWA 专用流程里强制设置：

- `MEMORY_ANKI_DEPLOY_TARGET=local`
- `MEMORY_ANKI_DATABASE_URL=`
- `VITE_API_ORIGIN=`

这意味着即使系统环境或 `.env` 里残留云端数据库连接、云部署标记或远程 API 地址，PWA 的前端构建、数据库准备、迁移和后端启动都会回到本机 SQLite 与同源 API。不要把 PWA 改成依赖 Supabase、Render、Vercel 或其他云端服务；云部署说明请单独看 `supabase-vercel-render说明.md` 和 `docs/cloud-deployment.md`。

PWA 默认也会跳过百度云盘启动同步，避免开机自启时被同步锁或网络状态卡住。正常跨设备同步仍由桌面端 `start-desktop.bat` / `stop.bat` 负责。

## 日常使用

1. 电脑开机并确保 Tailscale 已连接。
2. 如果已安装自启，PWA 服务会随 Windows 登录自动启动；否则双击根目录的 `start-pwa.bat`。
3. 手机打开 Tailscale。
4. 用 Safari 或 Chrome 打开：

```text
https://desktop-lp-2026481850.tail92e457.ts.net/freestyle
```

5. 第一次打开后，使用浏览器菜单添加到主屏幕。

## 首次配置与启动

### 1. 构建前端（自动）

`start-pwa.bat` 会在启动前自动重新构建前端，所以更新代码后直接双击 `start-pwa.bat` 即可，不需要手动打开终端运行 `npm run build`。

### 2. 启动 PWA 后端

在项目根目录双击或运行：

```powershell
.\start-pwa.bat
```

该脚本会：

- 使用生产构建的 `apps\web\dist`；
- 每次启动前自动执行前端构建，确保 PWA 拿到最新代码；
- 启动 FastAPI 到 `127.0.0.1:8012`；
- 默认打开完整桌面端应用，并以 `/freestyle` 作为 PWA 起始入口；
- 固定使用本机 SQLite 数据库，并清空云端 API / 云端数据库指向，作为云端不可用时的本地兜底入口；
- 默认跳过百度云盘启动同步，避免 PWA 自启被同步锁卡住。桌面端 `start-desktop.bat` / `stop.bat` 仍负责正常同步。

停止 PWA 后端：

```powershell
.\stop-pwa.bat
```

### 3. 启用 Tailscale Serve

先到 Tailscale 官网确认：

- `DNS` 页面开启 `MagicDNS`；
- 开启 `HTTPS certificates`；
- 允许 `Serve`。

如果本机脚本提示：

```text
Serve is not enabled on your tailnet.
To enable, visit: ...
```

打开它给出的链接并确认启用即可。不要开启 Funnel；Funnel 是公网暴露，本项目只需要 tailnet 内私有访问。

然后右键以管理员身份运行：

```text
configure-tailscale-pwa.bat
```

成功时会显示类似：

```text
Available within your tailnet:

https://desktop-lp-2026481850.tail92e457.ts.net/
|-- proxy http://127.0.0.1:8012
```

关闭 Tailscale Serve：

```powershell
tailscale serve --https=443 off
```

### 4. 安装 Windows 登录自启

运行：

```text
install-pwa-autostart.bat
```

如果 Windows 拒绝写入启动项，右键「以管理员身份运行」。它会在当前用户启动文件夹写入 `Memory Anki PWA.lnk`，登录 Windows 后自动运行 `start-pwa-hidden.ps1`。

取消自启：

```text
uninstall-pwa-autostart.bat
```

## 脚本说明

- `start-pwa.bat`：启动完整桌面端 PWA 后端，保持窗口/进程常驻，监听 `127.0.0.1:8012`。
- `start-pwa-hidden.ps1`：供自启使用的隐藏启动入口。
- `stop-pwa.bat`：停止占用 `8012` 的 PWA 后端。
- `configure-tailscale-pwa.bat`：配置 Tailscale Serve，将 HTTPS 转发到 `127.0.0.1:8012`。
- `install-pwa-autostart.bat`：安装 Windows 登录自启快捷方式。
- `uninstall-pwa-autostart.bat`：移除 Windows 登录自启快捷方式。
- `tools/pwa_server.py`：实际的 PWA 后端启动器。

## 日志和检查

- 前端构建日志：`logs/pwa-build.log`
- PWA 后端日志：`logs/pwa-api.log`
- 隐藏自启日志：`logs/pwa-startup.log`
- 数据库准备日志：`logs/runtime-prepare.log`
- 数据库迁移日志：`logs/runtime-migrate.log`

启动后先在电脑上打开 `http://127.0.0.1:8012/freestyle` 检查本机服务，再在手机 Tailscale 环境里打开 HTTPS 地址。Tailscale Serve 只做私有 tailnet 转发，不要开启 Funnel。

## 常见问题

### 手机打不开页面

检查：

1. 电脑是否开机并连接 Tailscale；
2. 手机是否打开 Tailscale；
3. 电脑上 `start-pwa.bat` 是否正在运行；
4. 电脑浏览器能否打开 `http://127.0.0.1:8012/freestyle`；
5. `configure-tailscale-pwa.bat` 是否已成功显示 `proxy http://127.0.0.1:8012`。

### 浏览器提示不是 PWA 或无法安装

PWA 安装需要 HTTPS。请用 Tailscale 的 HTTPS 地址访问：

```text
https://desktop-lp-2026481850.tail92e457.ts.net/freestyle
```

不要用 `http://127.0.0.1:8012/freestyle` 在手机上安装。

### 更新后仍看到旧界面

先重启 PWA 服务：

```powershell
.\stop-pwa.bat
.\start-pwa.bat
```

如果手机主屏幕 PWA 仍加载旧缓存，打开：

```text
https://desktop-lp-2026481850.tail92e457.ts.net/pwa-reset.html
```

清理完成后重新进入 `/freestyle`。

### Serve 提示没有启用

打开脚本提示的 Tailscale 官网链接，启用 Serve/HTTPS。也可以到 Tailscale 管理后台确认 `MagicDNS` 和 `HTTPS certificates` 已开启。

### 端口 8012 被占用

运行：

```powershell
.\stop-pwa.bat
.\start-pwa.bat
```

如果桌面端后端开发服务正在运行，它也可能占用 `8012`。PWA 和同端口后端服务不要同时争用 `8012`；Vite 前端开发端口仍按 `apps/web` 当前配置使用。
