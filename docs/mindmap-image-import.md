# 图片转脑图开发说明

## 环境变量
- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
  默认值：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- `DASHSCOPE_VISION_MODEL`
  默认值：`qwen3-vl-flash`

## 本地测试
PowerShell 示例：

```powershell
$env:DASHSCOPE_API_KEY="你的百炼密钥"
$env:DASHSCOPE_VISION_MODEL="qwen3-vl-flash"
```

然后启动后端与前端，进入宫殿编辑页，点击“图片转脑图”或直接在抽屉中粘贴图片。

## 连接被拒绝排查
- 默认基址是 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 实际请求地址会拼成 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- 如果看到 `[WinError 10061]` 或“连接被拒绝”，优先检查：
  - `DASHSCOPE_BASE_URL` 是否被覆盖成了本地地址、错误域名或错误端口
  - 本地代理、抓包工具、网关或安全软件是否拦截了请求
  - 当前机器到目标主机和端口是否可达
  - `DASHSCOPE_API_KEY` 是否已在启动后端的进程环境中设置

## 安全提示
- 不要把百炼密钥写入仓库文件。
- 如果密钥曾在聊天、截图或日志中暴露，正式使用前应在控制台更换新密钥。
