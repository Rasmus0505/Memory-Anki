# Memory Anki 云部署说明

本文记录当前项目的云端改造状态，方便后来的人判断 Supabase、Vercel、Render 分别承担什么职责，以及本地运行和云端运行之间的关系。

## 当前结论

当前采用的是 Vercel + Supabase 的纯云试运行方案：

- Vercel 托管前端静态资源和 FastAPI Serverless 函数。
- Supabase Postgres 保存应用业务数据。
- Vercel Preview Deployment Protection 用作私人访问保护。
- 本地/Tailscale 方案和云部署方案分开，不互相依赖。

当前云端入口：

```text
https://memory-anki-cloud-l3zecuwut-rasmus-projects-97d905dc.vercel.app
```

Supabase 项目：

```text
project ref: wdnjyswifxlolyzhrifx
region: us-east-2
database: Postgres 17
```

不要把数据库密码、API key、模型服务 key 写进仓库。Vercel 和 Render 都应通过平台环境变量保存 secret。

## 云端架构

### Vercel

Vercel 使用仓库根目录的 `vercel.json`：

- `apps/web` 使用 Vite 构建。
- `/api/*` rewrite 到 `api/index.py`。
- `api/index.py` 设置云端运行默认值，并导入 FastAPI app。
- 前端默认同源访问 `/api/v1`，所以部署在 Vercel 时可以不设置 `VITE_API_ORIGIN`。

Vercel Preview 需要的环境变量：

```text
MEMORY_ANKI_DEPLOY_TARGET=cloud
MEMORY_ANKI_STARTUP_MODE=serve
MEMORY_ANKI_CORS_ORIGINS=*
MEMORY_ANKI_DATABASE_URL=postgresql+psycopg://...
```

`MEMORY_ANKI_DATABASE_URL` 当前使用 Supabase Transaction Pooler，端口为 `6543`。连接串必须是 SQLAlchemy/psycopg 格式，也就是 `postgresql+psycopg://` 开头。

### Supabase

Supabase 当前只作为 Postgres 数据库使用。应用后端通过数据库连接串直连 Postgres，不在前端暴露 Supabase service role key。

已完成的数据库状态：

- `public` schema 有 29 张业务表。
- 所有业务表开启了 RLS。
- 当前服务端连接使用数据库用户访问，因此无需在浏览器端开放表级 Data API 权限。

注意：Supabase advisor 可能提示 `RLS Enabled No Policy`。在当前架构下，浏览器不直接访问 Supabase 表，后端服务负责访问数据库；因此这类 INFO 提示不是当前云试运行的阻塞项。若未来要让前端直接调用 Supabase Data API，则必须重新设计 Auth、RLS policy 和用户数据隔离。

### Render

Render 当前没有作为线上运行平台启用，只作为备选部署方案保留。

更适合考虑 Render 的情况：

- FastAPI 后端需要长连接、后台任务、队列、定时任务或持久本地磁盘。
- 需要 Web Service 常驻进程，而不是 Vercel Serverless 函数。
- 后续要把上传文件、导入任务、生成任务迁到更稳定的后端运行环境。

如果改用 Render，推荐形态是：

- `apps/web` 继续部署到 Vercel 或 Render Static Site。
- FastAPI 部署为 Render Web Service。
- 数据库仍使用 Supabase Postgres，或者迁移到 Render Postgres。
- 将 `VITE_API_ORIGIN` 设置为 Render API 域名。

Render Web Service 环境变量示例：

```text
MEMORY_ANKI_DEPLOY_TARGET=cloud
MEMORY_ANKI_STARTUP_MODE=serve
MEMORY_ANKI_DATABASE_URL=postgresql+psycopg://...
MEMORY_ANKI_CORS_ORIGINS=https://your-web-host.example
```

## 本地和云端数据同步

当前项目默认不是 SQLite 和 Supabase 的自动双向同步。

现在有两种运行模式：

- 本地默认模式：使用本机 SQLite 数据库。
- 云端模式：使用 Supabase Postgres。

如果在网站上学习，数据会写入 Supabase；它不会自动回写到本机 SQLite 文件。如果想让本地也看到云端数据，推荐让本地 API 也连接同一个 Supabase Postgres：

```text
MEMORY_ANKI_DEPLOY_TARGET=cloud
MEMORY_ANKI_DATABASE_URL=postgresql+psycopg://...
MEMORY_ANKI_HOME=<一个本地可写目录>
```

这样本地和网站访问的是同一个远端数据库，不需要额外同步。但要注意：

- 本地离线使用能力会变弱，因为数据库依赖网络。
- 不要把真实连接串提交到 `.env.example` 或任何文档。
- 附件、导入中间文件、生成媒体等仍可能依赖本地文件系统；这些还没有完整迁移到 Supabase Storage。

如果必须保留本地 SQLite，并希望和 Supabase 双向同步，需要单独开发同步层。建议先做单向迁移/导出导入，再评估双向同步：

1. SQLite 到 Supabase 的一次性导入。
2. Supabase 到 SQLite 的只读备份导出。
3. 设计冲突解决规则后，再做真正双向同步。

## 当前已知限制

- Vercel Serverless 文件系统只有 `/tmp` 可写，且不持久；代码已将云端运行目录默认设为 `/tmp/memory-anki`。
- 云端持久数据必须进 Supabase Postgres，不能依赖 Vercel 函数本地文件。
- 上传附件、生成媒体、导入任务文件仍需要后续迁移到对象存储，推荐 Supabase Storage 或 Render persistent disk。
- 云端数据库初始化当前使用 ORM baseline `create_all(checkfirst=True)`，不是完整 Alembic 云迁移链路。
- Vercel Preview 域名在部分本地网络可能解析或访问异常；这不等于部署失败，应以 Vercel Dashboard 状态和运行日志为准。

## 日常操作

部署 Vercel Preview：

```powershell
vercel deploy -y --no-wait --scope rasmus-projects-97d905dc
```

查看部署状态：

```powershell
vercel inspect <deployment-url> --scope rasmus-projects-97d905dc
```

查看 Vercel 环境变量：

```powershell
vercel env ls --scope rasmus-projects-97d905dc
```

本地验证 Supabase 连接时，不要打印真实连接串，只验证表数量或健康接口即可。

