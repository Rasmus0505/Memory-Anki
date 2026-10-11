# 学习闭环 MVP 实现与验证记录

## 已实现

- 保留固定复习阶梯、1/2 不通过、3/4 通过及提前练习规则。区别同次改分与真实重练；后续已发生真实评分时，较早尝试只读。
- 评分即时选中不等于保存成功：只有服务端确认才更新通过、重练和完成状态。连续改分中，较新请求失败不抹掉较早已保存的评分。
- 随时收工保留未评分、薄弱项与原轮次；收工不是全部完成。小结算不清除题目进度，最终收工明确选择保留或清除实际涉及宫殿的已做状态。
- 所有结算界面暂停学习时钟，回到学习恢复。分别展示本轮累计与本轮今日；按权威日期边界裁切时间区间并去重。缺少日期证据的旧时长保留累计并提示，不能假算成今日。
- 内容编辑不自动降档；拆分、新内容按最近有进度祖先继承，合并保守取较低阶梯与较早日期。继承方案在写入前完整计算、校验，损坏数据显式失败，不留下半套变更。

产品约定见 [学习闭环 MVP](<learning-loop-mvp.md>)。

## 验证结果

以下为共享工作树上的实际运行结果，不表示整个项目已达到发布门槛。

| 检查 | 结果 |
| --- | --- |
| 最新前端 TypeScript 与隔离生产构建 | 通过；未覆盖日常服务的 dist |
| 最终全量 hermetic Playwright | 56 通过、4 项按平台跳过、0 失败；桌面 Chromium / 移动 Chromium / 移动 WebKit，最新隔离构建 |
| 架构检查器自身回归 | 169 通过 |
| 全量后端 pytest | 993 通过，6 失败 |
| 全量前端 Vitest | 2508 通过，10 失败，另有 6 个未捕获异常 |
| 最后评分组件回归 | 71 通过 |
| 最后 encounter 回归 | 34 通过；修改文件 mypy 通过 |
| 继承专项回归 | 105 通过；范围内 Ruff 与 mypy 通过 |
| 今日投影与结算时间专项 | 30 通过：后端 15、前端日期 4、时钟 4、结算卡片 7 |
| 最终全量 mypy | 6 个错误，分布在 4 个非本次修改文件 |
| 最终全量 ESLint | 2 错误、2 警告；均在未改动文件 |
| 规范入口 `python tools/quality_gate.py --full` | 未通过；停在架构检查，不能视为后续步骤通过 |

全量运行后最后两处后端修改仅补充准确类型收窄/重载；评分组件后来完成追加回归。因此上述全量数字是明确的一次运行快照，不冒充所有最终文件的重新全量运行。

### 已定位但未扩大范围修改的失败

- 后端 6 项失败涉及 dashboard 与 study-session 测试读取已缺失的统计响应字段，例如 `due_count`、`monthly_total_review_duration_seconds`；没有通过添加虚构统计字段消除失败。
- 前端 10 项失败：Insights 旧响应刷新 1 项、HTTP mutation mock 参数 1 项、NodeBoundQuiz 快捷键 mock 缺少导出 2 项、PalaceShelf 测试缺 QueryClientProvider 6 项（对应 6 个未捕获异常）。这 4 个测试文件单独重跑仍为 10 失败、20 通过。
- 全量 mypy 剩余错误：[时间账本缓存](<../apps/api/src/memory_anki/infrastructure/time_ledger_store.py>)容器类型 2 项、[科目阶梯](<../apps/api/src/memory_anki/modules/memory/application/subject_memory_ladder.py>)空 ID 1 项、[关联做题服务](<../apps/api/src/memory_anki/modules/practice/application/overlay_quiz_service.py>)变量类型 2 项、[仪表盘路由](<../apps/api/src/memory_anki/modules/dashboard/presentation/router.py>)可空缓存 1 项。本次轮次响应和评分尝试引入的类型问题已修复。
- 架构门禁仍报告 8 个超 750 行的文件、英语领域层依赖 React/window，以及内容路由自行拥有数据库会话。没有放宽规则或改动英语专项以强行过关。
- ESLint 剩余项：[持久化测试](<../apps/web/src/shared/persistence/mutationQueue.test.ts>)未使用的 conflict、[持久化队列](<../apps/web/src/shared/persistence/mutationQueue.ts>)未使用的 body；[节点卡模型](<../apps/web/src/shared/ui/mindmap-canvas/nodeCardModel.ts>)两处无效赋值。
- 最后补跑时间、轮次范围与继承三组后端测试共 28 项通过；所有修改的后端生产模块 Ruff 通过。

## 数据与发布边界

测试使用隔离数据库与 mock 浏览器接口；不对真实学习库运行回归。隔离构建仅用于验收，不等于日常服务已更新；未运行会中断共享服务的 launcher smoke，也未重启日常服务。共享思维导图修改保留。

无日期证据的历史学习秒数无法精确回溯某天；日期窗口过期、尚未核对时显示等待核对，而不是编造今日值。
