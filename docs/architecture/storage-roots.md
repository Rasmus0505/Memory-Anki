# 存储根目录

`local_app_home` 下的运行时文件拆分为三个同级文件夹。代码与 Git 留在仓库中；此布局仅适用于已配置的 Memory Anki 主目录。

| 根 | 文件夹名 | 日常学习 | 内容 |
|---|---|---|---|
| learning | `学习数据` | 必需 | SQLite（`memory_palace.db`）、英语媒体、英语阅读词典、语音教练 |
| attachments | `学科附件` | PDF/文档需要 | 学科 PDF（`subjects/`）与 PDF 库 |
| cache | `日志缓存` | 非必需 | 备份、AI 日志、OCR 缓存、导入任务、生成工作区、运行时锁 |

`migration-state.json` 留在主目录根，以便布局迁移在文件夹存在之前找到它。

自动备份仍仅限数据库。缓存与附件树不会被复制进滚动/抢救快照。

一次性文件系统迁移（`migration-state.json` 中的 `split_three_storage_roots`）把之前的扁平布局（`data/`、`english/`、`pdf_library/`、……）移入这三个根，且不覆盖较新的文件。
