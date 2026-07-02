这是一个我自用的个人学习产品，只在电脑端使用，不使用移动端，不发给别人，不担心数据泄露；
两台电脑跨设备使用，不同设备能够识别另外一个设备上次的数据进度然后进行同步数据，当前使用的数据同步方案是用百度网盘的同步空间；
在local-config\memory-anki.local.json你可以看见当前是哪个电脑，一个是Laptop，一个是desktop；
注意你的代码修改要适用在两台设备都能正常运行，不能写出只能当前设备使用的代码；
涉及必要共用的环境配置要写清楚，避免跨设备无法使用找不到原因
gitignore必须使得两台设备之间只通过git就可以拉取到可以完整开发和正常运行的代码

架构修改前必须先读 docs\architecture\README.md，并确认 git status，不能覆盖其他并行改动。
先判断数据 owner、API owner、UI owner，默认只在 owner 内修改；跨 owner 只能走 public contract、barrel 或 port。
后端 router 不写业务流程和 ORM 查询；frontend shared 不依赖 app/features/entities；app/router 只做路由装配。
如果必须临时弯曲边界，登记 docs\architecture\boundary-exceptions.json，写清 owner、移除条件和回归测试。
新增 runtime 路径、持久化字段、OpenAPI schema 或架构规则时，同步 storage-layout、合同/生成类型、tools\check_architecture.py 和最小测试。
