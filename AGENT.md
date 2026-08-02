这是一个我自用的个人学习产品，PWA 也使用完整桌面端前端，不再维护单独移动端应用；不做公开发布、不面向多用户，不担心数据泄露；
两台电脑跨设备使用；运行时数据（数据库与附件等）放在每台电脑各自的 Syncthing 同步文件夹中（例如 `F:\memory anki data`，盘符按本机实际情况填写）。Syncthing 在应用外负责两台电脑之间同步；不要再使用百度网盘 MemoryAnki-Sync，也不要配置 app-home 为固定盘符或配置 sync_root；应用内 `sync_enabled`、`sync_on_start`、`sync_on_stop` 默认关闭。
在local-config\memory-anki.local.json你可以看见当前是哪个电脑，一个是Laptop，一个是desktop；
注意你的代码修改要适用在两台设备都能正常运行，不能写出只能当前设备使用的代码；
涉及必要共用的环境配置要写清楚，避免跨设备无法使用找不到原因
gitignore必须使得两台设备之间只通过git就可以拉取到可以完整开发和正常运行的代码
PWA 只使用现有后端和本地数据，默认入口是 /freestyle，日常访问说明以 PWA.md 为准；不要把它扩展成公开移动 App、独立移动端或独立云服务。
