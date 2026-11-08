# 2026-11-08 工程复盘

> 范围：工作区未提交改动 + `14e48ad1..9fa7c4fb` 这 12 个提交。
> 基线：前端 401 个测试文件 / 2752 个用例通过，`tsc -b --noEmit` 通过；
> 后端 1228 通过、1 失败（已修）；`tools/check_architecture.py` 通过。
> 本文只记录能指回代码、测试或实测数字的结论；推断会标出来。

## 1. 反复出现的问题

### 1.1 本地小结算与服务端不一致（问题 0007）

**现象**：进度条只剩 16 格，做题范围却有 36 座宫殿；本地 `compressedIds` 69，
服务端 `compressed_ids` 35。

**根因**：压缩集合在三个地方各自做并集——`compressRoundPlanCards` 只加不减，
`applyServerCohorts` 取并集，`commitHydratedRoundLedger` 最终又取一次并集。
服务端有权拒绝一个仍欠重练的分组，回显里没有这些 id，但本地把它们留下了；
集合写进 localStorage，偏差跨刷新累积。

**修法**：服务端回显是唯一权威。`replaceCompressedIds` 替换而非并集；
`applyServerCohorts` / `commitHydratedRoundLedger` 采用服务端集合；只有离线、
没有服务端负载时才保留本地草稿。`compressibleRoundPlanIds` 看到源卡还有
`retryAvailableAt` 就不再请求结算，从源头避开服务端会拒绝的那一批。

**防复发**：问题档案 0007 + `roundPlan.test.ts` / `hydrateRoundLedger.test.ts`
的“被拒卡回到计划”用例。

### 1.2 两套做题窗口

**现象**：`NodeBoundQuizDialog` 与 `FreestyleScopeQuizDialog` 长期并存；同一个
“本轮评分徽标”在两处分别实现，关联题目一度完全不显示评分（问题 0002 第 11 节），
快捷键、选项打乱、题号轨道也不断只在其中一边修。

**根因**：第二个入口复制了第一套窗口，而不是复用同一份会话与展示。之后每次需求
都要求“两个窗口都改”，但门禁只检查路径字符串，无法证明行为一致。

**修法**：删除 `widgets/node-bound-quiz` 整套实现，节点角标、脑图复习卡、编辑页、
随心工具栏和轮次都进 `FreestyleScopeQuizDialog`。直接题目集由
`useDirectQuestionSetQuiz` 提供，轮次模式仍由 overlay 提供；轮次专属操作保留
位置但禁用。架构门禁改为守护这一个入口。

### 1.3 非手势滚动被当成翻页

**现象**：评分回执重排、原生吸附、迟到布局修正都会改 `scrollTop`，随后被写成
一次 `set_cursor`，页面再重排、再漂移，学习者感觉被推着走。

**根因**：把“`scrollTop` 变了”当成“学习者翻页了”。之前的修复都在 `scroll`
处理里加条件，没有一个地方回答“这次滚动有没有手指/滚轮”。

**修法**：拆出 `useFreestyleFeedScrollIntent`（只记录手指、触控笔、滚轮）、
`useFreestyleFeedScrollGeometry`（只测量页高）、`useFreestyleFeedScrollSettle`
（有手势才提交落点，没有就把已提交卡片钉回去）。程序化滚动窗口结束后补一次
收尾，翻页落点比整页边界多 1px，避开 mandatory snap 的边界归属。

### 1.4 设计 token 漂移

**现象**：提交 `9fa7c4fb` 标题是“收回靛蓝”，但编辑场景顶线仍留着
`hsl(262 60% 62%)`，本次才改成 `var(--color-mark)`。

**根因**：颜色字面量散落在 CSS/TSX 中，提交只能靠人眼搜；架构门禁不检查颜色。

**现状**：本次修掉残留紫尾并补了画布点阵；`apps/web/src` 仍有 68 处硬编码
Tailwind 色阶（多数是红/琥珀/紫的语义色）。**建议**加一条门禁：除
`foundation.css` 与明确列入白名单的语义色外，禁止新增 `hsl(...)` / 十六进制色值。
本条尚未实施。

### 1.5 做题卡移除后的聚合残留

**现象**：信息流不再渲染做题卡，但 `ImmersiveFreestylePage` 仍保留
`useFreestyleQuizFlow`、`answeredQuestionIds`、`quizCount`、`resolvedQuiz`，
结算页仍显示“做题卡片”指标。

**根因**：功能在卡片层移除，聚合层没有同步。卡片被 `withoutQuizCards` 过滤后，
这些计数恒为 0。

**现状**：本次没有改结算指标的含义——那是一个产品决定（改成做题窗口的已答数，
还是删掉该指标）。**建议**把题目进度收敛成一个 `RoundQuestionProgress` 投影，
由做题窗口写入，结算、进度条、目录都读它；不要再从信息流卡片反推。本条尚未实施。

## 2. 架构评估

### 2.1 后端

- 边界清楚：`domain` 纯规则、`application` 事务、`presentation` 路由；
  `tools/check_architecture.py` 的 198 个守卫测试全部通过。
- 本次把小结算的错题清理从 `round_state_service` 抽到 `round_settlement`，
  把恢复/排序两条纯规则放进 `round_plan_queue`。抽离后发现跨模块仍 import
  私有名 `_settle_round_wrong_markers`，已改成公开的
  `settle_round_wrong_markers`——私有名跨模块是隐式耦合，不应保留。
- 合并不再重置 FSRS：`inheritance_memory_source` 从贡献单元里选最弱的一份
  检查点，拓扑变化才替换，内容编辑只补缺。展示档位不再被误读成记忆状态。

### 2.2 前端

- 单一做题窗口把约 3000 行重复实现收成一份，是正确的“更深”方向；但
  `FreestyleScopeQuizDialog` 仍有 750+ 行，并且用 `isDirect` 在同一个组件里
  分叉两套状态。**建议**下一步把“题目集会话”（加载、进度、清空、删除）与
  “窗口展示”（工具栏、题号轨道、页脚）拆开，让轮次和直接题目集都实现同一个
  `QuestionSetSession` 接口。当前实现是可工作的过渡形态，不应继续往里加分支。
- 队列锁规则目前存在四份表达：`roundPlan.ts::lockedPlanIds`、
  `roundPlan.ts::reorderRoundPlan`（已改为复用 `lockedPlanIds`）、
  `useImmersiveQueue.ts::planWithQueueEdits`、后端
  `round_plan_queue.py::reorder_unscored_cards`。本次修掉了一个真实漂移：
  前端排序没有锁“仍欠重练的源卡”，会把它移到服务端预约重练的位置之外。
  **建议**沿用 `freestyle_config_cases.json` 的做法，加一份
  `queue_order_cases.json`，前后端测试读同一组输入与期望，防止四份规则再次分叉。

### 2.3 门禁

- 门禁大量依赖“某文件里必须出现某个字符串”。删除 `node-bound-quiz` 后，
  `tools/test_check_architecture.py` 仍有 16 处夹具在创建已删除的窗口，部分
  断言因此“通过但已经不再测试目标”。本次已改成新入口，并删掉无意义的夹具。
- 这类门禁能防删除，但不能防“行为分叉”。对跨语言规则，黄金样例比字符串
  检查更可靠；对前端单窗口，导入边界（只允许一个公开入口）比路径清单更可靠。

## 3. 文档、测试、注释

已修：

- `Memory-Anki-用户视角介绍.md` / `Memory-Anki-前端布局-用户视角.md` /
  `列表右键菜单.md`：删除“本轮安排”抽屉/表格的过时描述，改为左侧“随心列表”；
  沉浸页不再显示小城（地平线），文档同步。
- 代码内 “本轮安排正在更新” 的错误文案与多处注释改为“本轮队列 / 随心列表 /
  随心配置”。
- `test_overlay_wrong_priority_scope.py` 仍给已抽走的
  `round_state_service.list_unit_node_members` 打补丁，导致后端唯一失败；
  已改到 `round_settlement`。
- `test_settings_routes.py` 仍在往返已删除的 `thresholdSeconds`，已改成
  `{"enabled": false}`。
- `tools/test_check_architecture.py` 删除指向 `node-bound-quiz` 的死夹具。

仍然过时 / 未验证：

- `learning-loop-mvp-validation.md` 是带日期的历史快照，保留但不代表当前测试数。
- 新增的 `apps/web/e2e/freestyle-retry-rating.spec.ts` 本次没有跑浏览器，只做了
  类型检查；需要在有 PWA/后端的机器上 `npm run e2e` 验证。
- `AI_PROJECT_CONTEXT.md` 本次没有逐条核对；它描述的是更上层的所有权地图，
  若要作为交接基线，建议下一轮单独审计。

## 4. 冗余与误导逻辑

已删：

- 选项打乱的“用时阈值 / 恢复原顺序 / sessionStorage 待打乱标记”三套状态。
  现在只有一条规则：开关打开时，选择题作答完成立即换序。
- 第二套做题窗口及其 10 个测试文件、私有进度镜像、`useOverlayChoiceSelect`。
- 信息流里的 `FreestyleQuizCardView` 与做题卡分支。
- `.impeccable/`、`tmp-preview/` 加进 `.gitignore`，不再出现在工作区状态里。

仍存在：

- `ImmersiveFreestylePage` 的题目聚合（见 1.5）。
- `roundPlan.ts` 的 `lockedPlanIds` 与 `useImmersiveQueue.ts` 的内联锁集合
  语义相同、表达不同（见 2.2）。
- `round_plan.py` 作为门面重新导出 `round_plan_queue` 的两个函数，注释写的是
  “facade re-exports”，不是兼容层；新代码应直接 import `round_plan_queue`，
  门面只服务既有调用点。

## 5. 关联变更的统一设计

本次几组独立需求，单独看都合理，合在一起出现了共同结构：

1. **移出 / 恢复 / 排序**：三者都在改同一份队列，都需要“本地先动、服务端确认、
   迟到的旧快照不能覆盖”。现在共用 `saveQueueAction` 串行通道，但状态仍由
   `pendingReleaseIdsRef`、`releaseVersionRef`、`pendingOrderRef` 三个并行 ref
   各自维护。**建议**收敛成一个 `QueueEditIntent` 状态机：
   `pending → acked | superseded`，每个 intent 带 `roundId`、`cardId(s)`、
   `version`；投影时只问状态机“这条 intent 还该盖在服务端快照上吗”。
   这比再加一个 ref 更小，也更容易写并发测试。
2. **小结算 / 做题范围 / 进度条**：三者都读“本轮还剩什么”。现在小结算以服务端
   为准，做题范围由后端 `scope_palaces` 拥有，进度条读本地计划；0007 修的是让
   本地计划跟随服务端压缩集合。**建议**把“本轮剩余身份”做成一个后端投影
   （round → remaining card ids / palace ids），前端只渲染，不再自己合并。
3. **等级条 / 评分条 / 手动改档**：本次已经走同一条路径（目标预览 → 确认 →
   本轮已评分），没有新增第二套状态；这是正确的合并方向。

## 6. 并行冲突

- **压缩集合的双主人**：本地与服务端都认为自己在决定“哪些卡结算了”，已由
  “服务端回显唯一权威”解决。
- **排序的本地意图 vs 远端排序**：本地的 `pendingOrderRef` 会盖在较新的服务端
  快照上，直到自己的 reorder ACK。若另一台设备在此期间排序，本地在线的意图
  仍会赢（last-write-wins）。这是有意选择，但没有专门的并发测试；**建议**补一个
  “远端先排序、本地后 ACK”的用例，明确期望。
- **恢复 vs 远端移出**：`releaseVersionRef` 允许版本更新的远端移出覆盖本地恢复，
  同版本或更旧则保护本地恢复。这个规则正确，但同样缺跨设备用例。
- **滚动有两个主人**：`useFreestyleWheelPaging` 负责滚轮翻页，原生滚动负责手势。
  滚轮路径 `preventDefault`，不再让原生吸附看到 delta；意图钩子只负责“这次
  滚动算不算用户动作”。两者职责已分开。
- **分支并行**：`.claude/worktrees/3d-11.6` 仍拥有学习小城，main 这次在沉浸页
  隐藏 `CityHorizon`。如果城市分支也改 `AppShell`，合并时会有冲突；城市改动
  继续留在该工作树，不要为了本次改动把两边合成一个提交。

## 7. 本次提交的边界

按功能拆成 11 个提交：

1. 记忆：合并学习单元时继承 FSRS 检查点
2. 题目回收：删卡后归到最近存活的父节点
3. 题目徽标：悬空绑定计入根节点
4. 随心：未评分队列可排序，小结算抽成独立模块
5. 做题：合并为一个做题窗口
6. 复习等级条：拖动时预览真实间隔，确认后本轮记为已评分
7. 做题：选项打乱改为作答后立即换序
8. 随心：本地小结算改为采用服务端回显
9. 随心：只有学习者手势才算翻页
10. 随心：左侧列表接管本轮队列，页面只保留一种做题入口
11. 视觉：收回残留靛蓝，补齐纸墨令牌与调试浮标

（编号按实际提交顺序，文档与数据脚本另起一个提交。）

## 8. 还没做的

- 结算页“做题卡片”指标的含义（见 1.5）。
- `QueueEditIntent` 状态机与跨设备排序/恢复用例（见 5、6）。
- `queue_order_cases.json` 前后端黄金样例（见 2.2）。
- 颜色字面量门禁（见 1.4）。
- 新增 e2e 的浏览器实跑（见 3）。
