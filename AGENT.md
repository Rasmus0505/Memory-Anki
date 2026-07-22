这是一个我自用的个人学习产品，PWA 也使用完整桌面端前端，不再维护单独移动端应用；不做公开发布、不面向多用户，不担心数据泄露；
两台电脑跨设备使用；运行时数据（数据库与附件等）唯一放在共享 U 盘上，卷标 MemoryAnki，配置为 vol:MemoryAnki/memory anki data。不要再使用百度网盘 MemoryAnki-Sync 作为 app-home 或 sync_root；sync_enabled 默认关闭。
在local-config\memory-anki.local.json你可以看见当前是哪个电脑，一个是Laptop，一个是desktop；
注意你的代码修改要适用在两台设备都能正常运行，不能写出只能当前设备使用的代码；
涉及必要共用的环境配置要写清楚，避免跨设备无法使用找不到原因
gitignore必须使得两台设备之间只通过git就可以拉取到可以完整开发和正常运行的代码
PWA 只使用现有后端和本地数据，默认入口是 /freestyle，日常访问说明以 PWA.md 为准；不要把它扩展成公开移动 App、独立移动端或独立云服务。
