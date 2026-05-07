# CLAUDE.md — 记忆宫殿复习系统

## 项目概述

个人使用的记忆宫殿管理工具。记录每天创造的记忆宫殿，按记忆曲线自动安排复习。

## 技术架构

- **后端**: FastAPI REST API, 端口 8000
- **前端**: Vite + React + shadcn/ui, 端口 5173
- **数据库**: SQLite (data/memory_palace.db)
- **存储**: 本地文件系统 (data/attachments/)

## 项目结构

```
D:\Memory Anki\
├── CLAUDE.md              # 本文件 - AI 开工前必读
├── start.bat              # 一键启动入口
├── doc/
│   └── requirements.md    # 用户需求变更记录
├── backend/               # FastAPI 后端
│   ├── app.py             # 入口
│   ├── models.py          # SQLAlchemy 数据模型
│   ├── schemas.py         # Pydantic 校验
│   ├── config.py          # 配置
│   ├── services/          # 业务逻辑
│   └── routers/           # API 路由
├── frontend/              # React 前端
│   ├── src/
│   │   ├── api/           # API 调用层
│   │   ├── components/    # shadcn 组件
│   │   ├── pages/         # 页面
│   │   └── lib/           # 工具函数
│   └── ...
└── data/                  # 运行时数据 (不纳入版本控制)
```

## AI 协作规则

1. **开工前**：先读取 `doc/requirements.md` 了解用户最新需求
2. **修改代码前**：理解现有架构，遵循项目结构
3. **前端组件**：优先使用 shadcn/ui 组件，保持 UI 一致性
4. **后端 API**：返回 JSON，不渲染模板
5. **文件管理**：附件存 data/attachments/，数据库存 data/
6. **启动方式**：`start.bat` 一键启动前后端
7. **文档记录**：每次用户提新需求，记录到 doc/requirements.md
