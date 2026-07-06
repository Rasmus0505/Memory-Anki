# Memory Anki 移动端 PWA 使用说明

本文说明如何把移动端「随心模式」作为 PWA 通过 Tailscale 私有网络使用。目标是：电脑开着，iPhone 打开 Tailscale，就能访问并安装 `/m`。

## 日常使用

1. 电脑开机并确保 Tailscale 已连接。
2. 如果已安装自启，PWA 服务会随 Windows 登录自动启动；否则双击根目录的 `start-pwa.bat`。
3. iPhone 打开 Tailscale。
4. 用 Safari 打开：

```text
https://desktop-lp-2026481850.tail92e457.ts.net/m
```

5. 第一次打开后，在 Safari 点「分享」→「添加到主屏幕」。

## 首次配置

### 1. 构建前端（自动）

`start-pwa.bat` 会在启动前自动重新构建前端，所以更新代码后直接双击 `start-pwa.bat` 即可，不需要手动打开终端运行 `npm run build`。

### 2. 启动 PWA 后端

在项目根目录双击或运行：

```powershell
.\start-pwa.bat
```

该脚本会：

- 使用生产构建的 `apps\web\dist`；
- 每次启动前自动执行前端构建，确保手机端拿到最新 PWA 代码；
- 启动 FastAPI 到 `127.0.0.1:8012`；
- 将 `/m` 作为移动端随心模式入口；
- 默认跳过百度云盘启动同步，避免手机 PWA 自启被同步锁卡住。桌面端 `start-desktop.bat` / `stop.bat` 仍负责正常同步。

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

- `start-pwa.bat`：启动移动端 PWA 后端，保持窗口/进程常驻。
- `start-pwa-hidden.ps1`：供自启使用的隐藏启动入口。
- `stop-pwa.bat`：停止占用 `8012` 的 PWA 后端。
- `configure-tailscale-pwa.bat`：配置 Tailscale Serve，将 HTTPS 转发到 `127.0.0.1:8012`。
- `install-pwa-autostart.bat`：安装 Windows 登录自启快捷方式。
- `uninstall-pwa-autostart.bat`：移除 Windows 登录自启快捷方式。
- `tools/pwa_server.py`：实际的 PWA 后端启动器。

## 常见问题

### iPhone 打不开页面

检查：

1. 电脑是否开机并连接 Tailscale；
2. iPhone 是否打开 Tailscale；
3. 电脑上 `start-pwa.bat` 是否正在运行；
4. 电脑浏览器能否打开 `http://127.0.0.1:8012/m`；
5. `configure-tailscale-pwa.bat` 是否已成功显示 `proxy http://127.0.0.1:8012`。

### 浏览器提示不是 PWA 或无法安装

PWA 安装需要 HTTPS。请用 Tailscale 的 HTTPS 地址访问：

```text
https://desktop-lp-2026481850.tail92e457.ts.net/m
```

不要用 `http://127.0.0.1:8012/m` 在手机上安装。

### Serve 提示没有启用

打开脚本提示的 Tailscale 官网链接，启用 Serve/HTTPS。也可以到 Tailscale 管理后台确认 `MagicDNS` 和 `HTTPS certificates` 已开启。

### 端口 8012 被占用

运行：

```powershell
.\stop-pwa.bat
.\start-pwa.bat
```

如果桌面端开发服务正在运行，它也可能占用 `8012`。移动端 PWA 和桌面开发服务不要同时争用同一个端口。
