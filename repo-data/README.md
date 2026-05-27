# Repo Data

该目录现在是 Memory Anki 的正式仓库内运行目录。

- 启动脚本会把 `MEMORY_ANKI_HOME` 默认设为此目录
- 实际数据库位于 `repo-data/data/memory_palace.db`
- 附件位于 `repo-data/data/attachments`
- `repo-data/data/backups` 仍默认忽略，不自动提交

双设备同步建议：

1. 使用前先 `git pull`
2. 使用后及时提交并 `git push`
3. 尽量避免两台设备同时打开并分别写入数据库
