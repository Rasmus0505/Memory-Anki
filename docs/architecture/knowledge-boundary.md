# 知识上下文边界

知识拥有学科、章节、章节树和学科脑图文档。宫殿拥有宫殿到章节的绑定不变量；备份拥有文件系统快照策略。

## 依赖方向

```text
knowledge.application -> mindmap_document.api
knowledge.application -> content.api
knowledge.application -> backups.api
knowledge.application -> memory.api (read-only unit projections for chapter palace cards)
```

知识调用单一的 `update_palace_chapter_binding` 公共命令，而不是自行协调宫殿链接展开与对账。读取端点从不核对绑定；不一致状态保持可观察，直到显式写入或维护命令修复它。

章节宫殿列表卡片可以调用复习公共门面，以获取永久标记数、单元数、到期单元数和下次复习日期。知识不得导入私有的复习应用模块，也不得修改复习单元状态。

`ChapterCreate` 和 `ChapterUpdate` 属于知识请求契约，不得定义在宫殿领域 schema 中。滚动备份触发是由 `backups.api` 导出的显式提交后能力。

## 学科编辑器文档

章节 CRUD（`create_chapter` / `update_chapter` / `delete_chapter`）必须在提交前根据章节树重写学科的 `editor_doc`，使 GET 编辑器指纹立即变化，过期的脑图保存会返回 409，而不是静默丢弃新章节。保存学科脑图仍会删除已从文档中移除的空章节，但对于仍有宫殿或测验题目的章节，它不能绕过 `delete_chapter` 的保护。

## 事务归属

所有知识学科和章节写入命令都接收 `platform.application.UnitOfWork`。FastAPI 组合构造 `SqlAlchemyUnitOfWork`；应用服务从不直接调用 `Session.commit()` 或 `Session.rollback()`。滚动备份仅在 UoW 提交成功后运行。

## 变更响应

知识的学科/章节创建在表现层提取平台 `MutationIdentity`，并通过 `SqlAlchemyMutationResponseStore` 在现有的应用 `UnitOfWork` 内持久化响应。知识不再依赖过渡期的 Persistence 上下文，路由错误处理通过该命令所用的同一 UoW 适配器回滚。


## 宫殿学科归属

知识拥有学科、章节和学科脑图文档。宫殿拥有显式的 `palace_subjects`、章节绑定修订、主章节修复，以及“显式关联的章节属于显式拥有的学科”这一不变量。当仍存在章节或宫殿归属引用时，学科删除会被阻止。宫殿编辑器可以通过知识的公共 HTTP 契约创建学科，但所有宫殿归属变更都使用宫殿的知识绑定命令。
