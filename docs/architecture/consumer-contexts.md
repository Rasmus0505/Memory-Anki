# 消费方上下文边界

搜索和随心是以读取为导向的消费方上下文。它们组合由其他上下文拥有的能力，但不依赖另一个上下文的内部应用模块。

## 搜索

```text
search.application -> content.api
```

搜索拥有查询匹配和结果塑形。宫殿拥有标题解析。

## 随心

```text
practice.application -> english.api
practice.application -> quiz.api
practice.application -> content.api
practice.application -> memory.api
```

每个门面都刻意保持狭窄：最近英语课程续学、测验题目序列化、宫殿上下文投影和到期复习策略。新的随心卡片类型必须向所属上下文请求显式的公共能力，而不是导入其服务实现。

### 沉浸式信息流队列

`POST /api/v1/freestyle/queue/build` 组合一个有限的沉浸式队列：

- **宫殿门面**：稳定的树结构，仅用于渲染完整宫殿并解析上下文路径（`list_active_palace_tree_structures`）。
- **复习门面**：活动的永久标记单元、稳定成员关系、修订、真实间隔和到期日期（`get_palace_unit_projection`）。复习拥有所有宫殿排期写入（评分、手动调整排期、撤销内容降级批次、对账）。UI 可以在该读模型之上显示单元投影面板以观察排期；它不得另造第二套排期存储。
- **宫殿测验门面**：已发布题目、节点绑定、掌握度画像（`list_published_questions_for_palaces`、`list_node_bindings_for_palaces`、`list_mastery_profiles_for_palaces` / `build_mastery_profile`）。

练习不会拆分宫殿文档。它把每个复习投影映射为一张带修订的队列卡片，并且仅将成员 UID 用于高亮和测验绑定。队列请求携带 `operation_id`；客户端忽略过期响应。并发文档或排期写入后出现的过期 `encounter` / 修订会被视为可重建的队列状态，而不是硬性的信息流失败。一个到期单元始终保留其宫殿复习卡片，即使从该单元内的节点生成了独立的 Anki 卡片。Anki 和测验卡片从不携带复习单元评分标识。

前端归属：

- 领域/配置/跳过/刷新：`apps/web/src/modules/practice` 经 `public.ts`
- 沉浸式页面/组件：`modules/practice/ui/freestyle` 及其公共门面
- 主导航包含 **随心**（`/freestyle`），这是唯一的沉浸式轮次。原 `/freestyle-2` 已由迁移 0072 合并进来，现在会重定向；不要重新引入第二条沉浸式路由
- 脑图卡片复用 `widgets/mindmap-review-flow`；测验卡片保留统一的作答证据，且不映射到宫殿单元排期

## 学习会话

跨上下文的会话读取、复习会话创建和可恢复进度操作仅通过 `session.api` 导出。记忆、内容与英语不得直接导入 `session.application` 模块。会话表现层仍可在内部自由组合自己的应用服务。

## 设置指标

设置指标通过 `backups.api` 消费备份目录数据。这使设置保持最终归平台所有的资格，并防止运维仪表盘绑定到备份生命周期实现模块。

## 独立的英语 FSRS

英语拥有 `english.api` 背后的共享 FSRS 运行时，供英语自己的课程练习使用。英语练习与宫殿复习单元是两条独立轨道：它们不共享宫殿复习单元状态，且不得调用宫殿单元评分命令。宫殿单元在 `memory` 内有自己的 FSRS 适配器（`unit_fsrs_adapter.py`），带有自己的固定设置；它不得导入英语运行时，英语上下文也不得调用宫殿单元评分命令。
