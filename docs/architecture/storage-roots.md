# Storage Roots

Runtime files under `local_app_home` are split into three sibling folders. Code and Git stay in the repository; this layout only applies to the configured Memory Anki home.

| Root | Folder name | Daily study | Contents |
|---|---|---|---|
| learning | `学习数据` | required | SQLite (`memory_palace.db`), English media, English reading lexicon, voice coach |
| attachments | `学科附件` | required for PDF/docs | Subject PDFs (`subjects/`) and PDF library |
| cache | `日志缓存` | not required | Backups, AI logs, OCR cache, import jobs, generation workspaces, runtime locks |

`migration-state.json` stays at the home root so layout migration can find it before folders exist.

Automatic backups remain database-only. Cache and attachment trees are not copied into rolling/rescue snapshots.

A one-time filesystem migration (`split_three_storage_roots` in `migration-state.json`) moves the previous flat layout (`data/`, `english/`, `pdf_library/`, …) into these three roots without overwriting newer files.
