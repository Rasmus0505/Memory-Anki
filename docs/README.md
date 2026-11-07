# Memory Anki 文档

> 文档入口。最后核对：2026-11-06。
> 现行文档描述“代码现在真正在做什么”；历史文档只保留当时的结论，不作为当前规则。

## 先看哪一篇

| 你是谁 / 想做什么 | 从这里开始 |
|---|---|
| 第一次了解产品 | [Memory-Anki-用户视角介绍.md](Memory-Anki-用户视角介绍.md) |
| 想看界面怎么排、手机怎么变 | [Memory-Anki-前端布局-用户视角.md](Memory-Anki-前端布局-用户视角.md) |
| 想改颜色、字体、间距、组件样式 | [../DESIGN.md](../DESIGN.md)（视觉系统）→ [../PRODUCT.md](../PRODUCT.md)（产品事实） |
| 想知道哪些列表能右键、各能做什么 | [列表右键菜单.md](列表右键菜单.md) |
| 想了解技术全貌 | [Memory-Anki-技术报告.md](Memory-Anki-技术报告.md) |
| 要看前端怎么组织、状态放哪 | [Memory-Anki-前端架构报告.md](Memory-Anki-前端架构报告.md) |
| 要改排期代码或查数据模型 | [复习排期设计.md](复习排期设计.md) → [Memory-Anki-复习调度与数据报告.md](Memory-Anki-复习调度与数据报告.md) |
| 要交接、排障、跑门禁 | [Memory-Anki-工程质量与运维报告.md](Memory-Anki-工程质量与运维报告.md) |
| 只想弄懂评分和间隔 | [复习排期-用户视角.md](复习排期-用户视角.md) |
| 要改代码、查架构边界 | `AI_PROJECT_CONTEXT.md`（仓库根目录）→ 本文“架构文档”一节 |
| 查历史故障和防复发措施 | [incidents/README.md](incidents/README.md) |
| 把 PDF 题目录进题库 | [quiz-pdf-reconciliation-prompt.md](quiz-pdf-reconciliation-prompt.md) |
| 题库里有重复题、想再清一遍 | [题库去重.md](题库去重.md) |

## 文档地图

| 文件 | 类型 | 状态 | 最后核对 |
|---|---|---|---|
| [Memory-Anki-用户视角介绍.md](Memory-Anki-用户视角介绍.md) | 产品说明（给人看） | 现行 | 2026-11-05 |
| [Memory-Anki-前端布局-用户视角.md](Memory-Anki-前端布局-用户视角.md) | 前端布局说明（用户语言） | 现行 | 2026-11-05 |
| [../DESIGN.md](../DESIGN.md) | 视觉系统：纸与灯、颜色/字体/间距/组件规则 | 现行 | 2026-11-08 |
| [../PRODUCT.md](../PRODUCT.md) | 产品事实：使用者、场景、约束、模式分配 | 现行 | 2026-11-08 |
| [design/impeccable-runbook.md](design/impeccable-runbook.md) | impeccable 24 命令运行记录与产物索引 | 现行 | 2026-11-08 |
| [design/audits/](design/audits/2026-11-08-shelf-insights.md) | 技术审查（书架 / 洞察） | 快照 | 2026-11-08 |
| [design/critiques/](design/critiques/2026-11-08-freestyle-start.md) | 设计评审（随心开始页） | 快照 | 2026-11-08 |
| [design/surfaces/](design/surfaces/round-settlement.md) | 结算页设计简报 | 现行 | 2026-11-08 |
| [列表右键菜单.md](列表右键菜单.md) | 列表右键 / 长按菜单与接入方式 | 现行 | 2026-11-06 |
| [Memory-Anki-技术报告.md](Memory-Anki-技术报告.md) | 技术总览报告 | 现行 | 2026-11-04 |
| [Memory-Anki-前端架构报告.md](Memory-Anki-前端架构报告.md) | 前端架构专项报告 | 现行 | 2026-11-05 |
| [Memory-Anki-复习调度与数据报告.md](Memory-Anki-复习调度与数据报告.md) | 排期实现与数据模型专项报告 | 现行 | 2026-11-04 |
| [Memory-Anki-工程质量与运维报告.md](Memory-Anki-工程质量与运维报告.md) | 质量门禁、测试、备份与排障专项报告 | 现行 | 2026-11-04 |
| [复习排期-用户视角.md](复习排期-用户视角.md) | 排期规则（用户语言） | 现行 | 2026-11-04 |
| [复习排期设计.md](复习排期设计.md) | 排期实现（开发者语言） | 现行 | 2026-11-04 |
| [learning-loop-mvp.md](learning-loop-mvp.md) | 学习闭环验收基线 | 规则仍有效；范围声明是当时口径 | 2026-11-04 |
| [learning-loop-mvp-validation.md](learning-loop-mvp-validation.md) | 验证快照 | 历史（数字不代表当前测试状态） | 2026-11-04 |
| [quiz-pdf-reconciliation-prompt.md](quiz-pdf-reconciliation-prompt.md) | PDF 题目录入流程 | 现行 | 2026-11-04 |
| [题库去重.md](题库去重.md) | 题库语义去重流水线与口径 | 现行 | 2026-11-06 |
| [incidents/](incidents/README.md) | 故障档案，一个主题一个文件 | 历史记录，持续追加 | 2026-11-04 |
| [compose/spec/](compose/spec/) | 随心功能 spec 与交付记录 | 历史（均已交付） | 2026-11-04 |
| [superpowers/specs/](superpowers/specs/) | 早期设计稿 | 历史（已实现或已被取代） | 2026-11-04 |
| [architecture/](architecture/README.md) | 架构门禁资产与守卫文档 | 现行（最小集） | 2026-11-04 |
| `resume-assets/`、`resume-*.pdf` | 个人简历材料 | 非产品文档 | — |

## 架构文档

2026-11-04 的清理提交删除了 40 份架构说明，只保留 `tools/check_architecture.py` 直接消费的 10 份：

- `architecture/README.md`、`context-map.yaml`、`boundary-exceptions.json`
- `architecture/mindmap.md`、`freestyle-immersive-feed.md`、`quiz-frontend-boundary.md`、`palace-quiz-boundary.md`
- `architecture/live-study-presence.md`、`session-recorder-privacy.md`、`unified-training-evidence.md`

这 10 份是**门禁资产**，不是完整的架构百科：删除、改名或改坏其中的守卫字符串，会直接让 `python tools/check_architecture.py` 失败。

其余架构信息以以下位置为准，不再恢复旧的长文档：

1. `AI_PROJECT_CONTEXT.md`：项目定位、技术栈、仓库/前后端结构、边界原则、运行命令；
2. `apps/**/MODULE.md`：每个前后端模块的职责与边界（18 份）；
3. 代码本身与 `tools/check_architecture.py` 的断言；
4. `context-map.yaml`：机器可读的模块、依赖边、端口、用例与 UnitOfWork 账本。

新增架构说明时，优先写进对应的 `MODULE.md` 或 `AI_PROJECT_CONTEXT.md`；确需新增门禁守卫文档时，再放进 `docs/architecture/` 并同步检查脚本。

## 维护规则

1. **现行文档**改动正文时，同时更新开头的“最后核对”日期。
2. **历史文档**不改写当时的结论；如果被新规则取代，在开头加“已被取代”说明并链接新文档。
3. 新增长期文档时，登记到本索引的文档地图。
4. `docs/architecture/` 的 10 份文件是门禁资产；改完先跑 `python tools/check_architecture.py`。
5. 文档一律使用简体中文；代码标识符、字段名和命令保留原文。
6. 本索引不记录临时交付物；一次性报告放 `deliverables/`，不要混进 `docs/`。
