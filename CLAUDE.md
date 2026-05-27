# CLAUDE.md — Memory Anki

## 项目概述

本项目是本地优先的记忆宫殿与复习工具，当前正式结构已经切换到 `apps/api` 与 `apps/web`。

## 当前结构

```text
D:\Memory Anki\
├── start.bat                # Windows 一键启动入口
├── apps/
│   ├── api/                 # FastAPI + SQLAlchemy + Alembic
│   │   ├── requirements.txt
│   │   └── src/memory_anki/
│   └── web/                 # React + Vite 前端
│       └── src/
├── docs/                    # 架构与项目文档
├── doc/Phase/               # 需求记录
├── tools/                   # 架构检查与辅助脚本
└── data/                    # 仅保留为 legacy migration source
```

## 运行与数据

- API 开发根：`apps/api`
- Web 开发根：`apps/web`
- 默认运行数据目录：`%LOCALAPPDATA%/MemoryAnki/data`
- 可通过环境变量 `MEMORY_ANKI_HOME` 覆盖运行目录
- 仓库根 `data/` 不是正式运行目录，只作为旧版本数据导入来源

## 启动方式

- Windows：运行 [start.bat](/D:/Memory%20Anki/start.bat)
- API 本地启动：在 `apps/api` 下运行 `python -m uvicorn --app-dir src memory_anki.app.main:app --host 127.0.0.1 --port 8000 --reload`
- Web 本地启动：在 `apps/web` 下运行 `npm run dev -- --host 127.0.0.1 --port 5173`

## 协作规则

1. 修改前先理解 `apps/api/src/memory_anki` 与 `apps/web/src` 的模块边界，不要回退到旧式全局堆叠结构。
2. 新运行数据、备份、附件都应落在 `%LOCALAPPDATA%/MemoryAnki` 或 `MEMORY_ANKI_HOME` 指向的目录。
3. 若仓库根存在旧 `data/`，应通过启动时迁移逻辑导入，不要把仓库内 `data/` 当作长期运行目录继续写入。
4. 需求记录写入 `D:\Memory Anki\doc\Phase\YYYY-MM-DD.md`。
5. 前端共享类型优先来自生成契约与 feature wrapper，不要重新引入旧的全局 API 杂糅入口。
