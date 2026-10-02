# 果冻翻卡舞台（Jelly Mindmap Stage）

> 本文说明只读翻卡场景下的独立展示层 `shared/ui/mindmap-canvas/JellyMindmapStage`：
> 它与 React Flow 编辑态并存、互不替代，负责把「通用图数据 + 视觉揭示投影」渲染成
> 左到右的果冻卡片舞台，并把翻卡动作翻译成 `map.*` 反馈线索。

## 一句话模型

`JellyMindmapStage` 是**无业务语义的只读展示层**：输入通用 `GraphData` 与 `MindMapNodeVisual`，
输出固定坐标系的卡片舞台、SVG 连线与 `map.land` / `map.settle` 反馈；
它不读取宫殿、分段、掌握度字段，也不写回 `editor_doc` 或真实经验值。

## 为什么需要独立舞台（而不是复用 React Flow）

React Flow 的节点是真实 DOM 内容，翻面时必须重新测量文字、可能改变折行，导致翻卡过程中文字抖动、
连线跳位。果冻舞台因此**不复用 React Flow 的节点 DOM**：

| 维度 | React Flow 画布 | 果冻翻卡舞台 |
|---|---|---|
| 主要职责 | 编辑态、拖拽、选择、文字选择/英语交互、通用节点外观 | 只读翻卡场景与揭示动画 |
| 文字测量 | 浏览器按内容实时测量 | 布局阶段一次性计算并冻结（固定卡宽） |
| 翻面实现 | 无内建翻面 | 固定外壳 + `preserve-3d` 双面内翻板 |
| 连线 | React Flow 边组件 | SVG 三次 Bézier |
| 回退关系 | 非果冻场景与编辑态的**唯一**入口 | 编辑、文字选择、非果冻场景一律回退 React Flow |

硬规则：**两者不得同时承担同一次翻卡**。宿主 `widgets/mindmap-review-flow/FlipCardMindMapPanel`
在非编辑、非英语、非纯文字模式下把容器标记为 `data-jelly-flip="true"`；反馈线索
（`recipes/map.ts`、`recipes/learning.ts`、`useMindMapRevealMotion.ts`、`webAudioFeedback.ts`）
统一查询该标记二选一发声，避免同一动作出现两套音效。

## 布局契约

`computeJellyLayout(graph)` 的固定事实（由 `JellyMindmapStage.test.ts` 锁定）：

- 坐标系固定为 **root → parent → leaf 左到右**；即使节点 `metadata` 是扁平结构，也从 `edges` 推导层级，
  保证仍落入正确列。
- 卡宽固定：根 `250px`、父 `260px`、叶 `270px`；同级卡片高度**取本组最高卡**，避免翻面时行高变化。
- 列间距 `170px`、兄弟间距 `24px`、舞台内边距 `90px`。
- 连线 `jellyBezierPath(from, to)` 从来源卡右边缘中点出发，三次 Bézier 落到目标卡左边缘中点。
- 叶子文本经 `plainTextOf` 归一化（`<br>` 转换行、剥离标签、解 `&nbsp;`、空文本回落「未命名知识点」）。

任何新增布局常量都必须同步更新 `JellyMindmapStage.test.ts` 中的契约断言，而不是只改实现。

## 动画与节奏常量

| 常量 | 值 | 含义 |
|---|---|---|
| `JELLY_FLIP_DURATION_MS` | 550 | 单卡果冻翻面时长，缓动 `cubic-bezier(0.34, 1.56, 0.64, 1)`（带过冲） |
| `JELLY_BATCH_STAGGER_MS` | 45 | 批量翻面的相邻卡启动间隔（节奏契约，`map.settle` 沿用同一节拍） |

- **叶卡**：在 `styles/jelly-mindmap-stage.css` 中，`.jelly-stage-node.is-leaf` 提供 `perspective: 1000px`，
  `.jelly-stage-flipper` 使用 `transform-style: preserve-3d` 与同一个 `cubic-bezier(.34,1.56,.64,1)` 过渡，
  由 `data-flipped='true'` 触发 `rotateY(180deg)`；两个面 `.jelly-stage-face` 均为 `backface-visibility: hidden`，
  背面自带 `rotateY(180deg)`。翻面只做 3D 内翻，不触发重新测量。
- **根卡 / 父卡**：保持静态，仅承受充能、回弹（`squashElement`）和 shockwave（`shockwaveElement`）。
- 舞台、SVG 边、卡片与反馈共用同一份布局矩形和屏幕坐标，避免动画与视觉位置各算一套。

## 父节点充能模型

充能计算是**纯函数**，位于 `shared/ui/mindmap-canvas/parentCharge.ts`，可在无 DOM 环境下单测：

- `planParentCharges(nodes)`：**只统计直接子节点**。
  - `phase === 'hidden'`（已发牌未翻）计入 `total`；
  - `phase === 'revealed'`（已翻）同时计入 `total` 与 `done`；
  - `phase === 'other'` 完全跳过（不参与充能）。
  - `mastered = done === total`。
- `planChargeBurst({ flips, parentOf, phaseOf })`：每张刚翻开的卡产生一颗飞向**直接父节点**的能量球；
  `freeze` 表示本批中至少有一个父节点被填满（整批只冻结一次）。
- `chargeEqual`：避免相同充能值重复触发动画。

投影边界：舞台只投影 `MASTERED`、充能进度、临时提示与**视觉** `+100 EXP`。
它**不修改真实 XP、不写文档、不提交业务状态**；真实成长数据由 `modules/progression` 只读投影提供。

## 反馈线索（`map.*`）

舞台通过 `@/shared/fx` 的 `cue()` 发声，不直接实例化 WebAudio / 粒子 / DOM 动效：

| 线索 | 载荷要点 | 语义 |
|---|---|---|
| `map.land` | `rect`、`delayMs` | 卡片落地 |
| `map.fold` | `rect`、`target()`、`onFirstArrive` | 卡片折叠飞向目标 |
| `map.branch` | `rect` | 分支整段揭示 |
| `map.settle` | `weight: 'single' \| 'batch'`、`charges[]`、`freeze` | 一次翻卡结算；`batch` 表示每个父节点合并为一次爆发 |

- `map.settle` 的 `charges[].label` 是**本地计数**（如 `2/5`），不得伪装成经验总量。
- `map.settle` 的 `delayMs` 保留果冻实验室的 45ms 节拍。
- 舞台内的动效必须绑定 `useFxOwner` 的 owner；owner 退役后，属于它的延迟步骤全部取消，
  陈旧序列不可能落到下一张卡上（详见 [fx-director.md](./fx-director.md)）。
- **果冻音效二选一**：`map.land` / `map.fold` / `map.settle` 的精确实验室音色只在
  `[data-jelly-flip="true"]` 场景内播放；非果冻场景继续使用各自的通用音色。
  同一次翻卡不得同时出现实验室音与通用音。

## 揭示投影的水合规则

判定逻辑是纯函数 `planRevealTransitions`（位于 `parentCharge.ts`，可无 DOM 单测）：

- 首次挂载、以及文档/场景切换（`graphIdentity` 变化）时，已有的 `revealed` 状态**静默水合**：
  只记录为已处理，不播放 crack、能量球或 `+100 EXP`。否则切换到已翻开的宫殿会重放整屏奖励。
- 只有同一文档内的后续 `hidden → revealed` / `revealed → hidden` 转变才产生 `map.land`、`map.settle`
  与 `map.fold` 反馈。
- 批量翻卡按节点顺序分配 `index * JELLY_BATCH_STAGGER_MS` 的翻转延迟，音效与能量球复用同一延迟；
  两者读同一份 `delayMsById`，不会漂移。
- 形如 `data-jelly-flip` 的场景标记由宿主面板提供，舞台自身标记 `data-jelly-stage="true"`。

## 大图导航与跟镜（canvas 本地）

- 折叠状态**不写回** `editor_doc`，仅 canvas 本地；节点数 ≥ 36 时默认折叠 `depth >= 1` 的有子节点分支；
  `practiceModeActive`（复习/练习）强制全展开。
- `minZoom` 可降到 `0.12` 支持鸟瞰；中大图开启 React Flow `onlyRenderVisibleElements`。
- **Enter reveal follow**：按 Enter 翻出的卡若被裁切，画布只做最小平移，把本步裁切最多的那张完整推进视野并留边距，
  保持当前缩放，约 200ms；连按打断上一次动画并跟上最新一步。
- 鼠标点卡、Shift 收回、`A`/`S` 批量翻卡**不挪视野**。
- 手机策略：`map` / `auto` 允许单指拖移，只有显式 `guided` 才把单指让给父级滚动；窄屏只读用更紧的 fit/zoom，
  翻卡走 pager，不靠在图上单指滑动。
- **不做**：MiniMap、搜索跳转、大纲双栏（宿主可另组）。

## 宿主接入

`JellyMindmapStage` 保持业务无关，业务语义由宿主通过 props 注入：

- `graphData`：通用节点/边。
- `selectedNodeId` / `selectedNodeIds` / `onNodeSelect` / `onNodeActivate` / `onNodeContextAction` / `onNodeHover`。
- `renderCard?(node, { isRoot, isParent, isLeaf })`：视觉子节点由图的投影提供，舞台不判断业务类型。
- `readonly`、`cameraNudge: 'still' | 'pan'`：只读与镜头策略。
- 命令式句柄 `JellyMindmapStageHandle { fitView(), focusNode(uid | null) }`。

宿主示例：`widgets/mindmap-review-flow` 与随心复习卡；通用画布见
`docs/architecture/mindmap.md`。

## 禁止事项

- 舞台内不出现 palace、segment、mastery、review 等业务字段或 API 调用。
- 不写回 `editor_doc`、不提交真实 XP、不修改成长状态。
- 不新增第二套粒子/音频实现；一律经 `cue()` 与 `@/shared/fx` 出口。
- 不为果冻舞台复制 React Flow 的节点 DOM 或第二套文字测量。
- 不让果冻舞台与非果冻回退路径同时对同一动作发声。

## 验证

- 布局与节奏契约：`apps/web/src/shared/ui/mindmap-canvas/JellyMindmapStage.test.ts`
- 渲染契约（双面翻板、仅叶卡翻转、270px、三次 Bézier、MASTERED、回调路由）：
  `apps/web/src/shared/ui/mindmap-canvas/JellyMindmapStage.render.test.tsx`
- 充能规则与水合判定：`apps/web/src/shared/ui/mindmap-canvas/parentCharge.test.ts`
- 揭示跟镜：`useMindMapRevealMotion.test.ts`、`useMindMapViewport.test.tsx`
- 反馈线索：`apps/web/src/shared/fx/recipes/map.ts`（配合 `shared/fx` 测试）
- 全局门禁：`python tools/quality_gate.py`（交付前 `--full`）

## 音效参数对照（HTML 实验室 → 实现）

实验室参考为 `HTML-preview/思维导图翻卡.html`（`theme === 'jelly'` 分支），`masterVolume = 0.85`：

| 音色 | 实验室 | `webAudioFeedback.ts` |
|---|---|---|
| 破壳 `playCrack` | sine 450→1100 @0.08s，gain×0.7，停 0.12s | `playFlipCrack` 同参数 |
| 喷射 `playShoot` | sine 360→920 @0.2s，gain×0.65，停 0.25s | `playFlipShoot` 同参数 |
| 撞击 `playImpact` | sine 和弦 `[523.25, 659.25, 783.99, 1046.5]`，gain×0.8，停 0.35s | `playFlipImpact` 同参数（共用一个包络） |
| 收卡 `playFold` | sine 800→320 @0.1s，gain×0.5，停 0.14s | `playFlipFold` 同参数 |

卡片几何同样对齐实验室：根 `250×115`、父 `260×120`、叶 `270×140`；翻面缓动
`cubic-bezier(0.34, 1.56, 0.64, 1)`、时长 `0.55s`；MASTERED 图章 `0.55s cubic-bezier(0.175, 0.885, 0.32, 1.4)`。
