# 脑图文档

脑图的纯文档领域代码。

- 负责规范化、序列化、指纹、节点标识符和遗留负载兼容性。
- 不得导入 FastAPI、SQLAlchemy、数据库表、palace、knowledge、backup 或学习模块。
- 其他后端模块只导入 `memory_anki.modules.mindmap_document.api`。
- 宫殿和知识模块负责 ORM 投影、持久化、冲突策略和版本创建。
