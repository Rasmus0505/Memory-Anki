# GitHub 学习进度同步

**结论：学习进度走「私有数据仓库 + 单份快照」，代码仓库保持公开；PDF 资料与视频不进入同步。**

## 同步什么

| 进入快照 | 不进入快照 |
|---|---|
| 宫殿、脑图、题库、题目绑定 | `学科附件/` 下的 PDF 资料（约 800 MB） |
| 复习卡状态、评分操作、做题记录 | `学习数据/english/media` 下的课程视频（约 240 MB） |
| 随心轮次、学习会话、偏好配置 | 日志、备份、历史快照 |

理由：进度每天变化但只有约 13 MB（75 MB 数据库压缩后）；附件基本不变且体积大，GitHub 单文件 100 MB 的硬限制装不下整包。

## 传输形态

- 仓库：私有仓库 `Rasmus0505/Memory-Anki-Data`（与公开的代码仓库分开）。
- 载体：GitHub Releases 的固定发布页 `latest`，挂两个附件 `learning-data.zip` 与 `snapshot.json`（来源设备、时间、SHA-256、关键表行数）。上传用 `gh release upload --clobber` 覆盖同名附件，远端永远只有最新一份，不进仓库历史。
- 为什么不是 git push：本机网络对 `github.com:443` 时通时断，而 `api.github.com` / `uploads.github.com` 稳定；Releases 也不需要本地克隆、凭据助手或强推。
- 本地同步目录：`C:\MemoryAnki\github-sync`，`sync-state.json` 记录本机水位，`.remote/` 缓存远端元数据。

## 接口

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/v1/export/progress` | 导出仅含数据库的 zip；manifest 的 `contents` 为 `["database"]` |
| POST | `/api/v1/import/progress/preview` | 校验 zip、报告 schema 是否匹配，不写数据 |
| POST | `/api/v1/import/progress` | 先留 rescue 快照，再整表替换；**不触碰附件目录** |

整库接口 `/export/full`、`/import/full` 保持原行为；`import/full` 会拒绝只含进度的压缩包，避免误删接收端附件。

## 正确性边界

1. **一次一台设备**。快照是整库替换，不是合并；两台同时学习会丢后同步那台的进度。
2. **程序版本必须一致**。导入要求 `alembic_revision` 完全匹配；不一致时拒绝并提示先升级。
3. **覆盖前有护栏**。上传前检查远端是否比本机上次同步更新；下载前检查本机最后一次同步后是否有新学习记录（数据库或 WAL 的写入时间）。
4. **导入是事务**。表替换在单个事务内完成；失败回滚，retry 一次由调用方负责。
5. **附件不参与校验**。接收端缺 PDF 时题目照常可做，只是打不开资料；大附件请另行一次性拷贝。

## 运维

- 双击项目根目录的 `同步学习数据.bat`：1 上传、2 下载、3 状态（脚本本体在 `tools/cross-device-sync/`）。
- 脚本：`tools/cross-device-sync/github-sync.ps1`，支持 `status|init|push|pull|menu`；依赖 `gh` 登录，不依赖 git 远端。
- 测试：`apps/api/tests/test_full_transfer_service.py` 覆盖「进度包不含附件」「导入不删附件」「整库导入拒绝进度包」。
