# Memory Anki · 「学习城市」需求说明

> 给其他 AI 的背景资料。用户是产品体验者，不写代码；请用产品语言解释取舍。
>
> **来源标注**：【文档】= 项目文件里明文写的；【判断】= 本次的设计建议，用户尚未逐条确认。不要把【判断】当成项目既有规定。

## 1. 项目是什么

**Memory Anki** 是一个私有、双设备的 Windows 学习产品，面向 2027 考研。核心是「宫殿（思维导图）+ 抽认卡 + 题库 + 间隔复习」：

- 一个宫殿是一张可编辑的思维导图，节点按层级组织知识点；复习时逐节点翻卡、评分，按 FSRS 与自定义阶段排期。
- 另有「随心」沉浸式信息流：卡片、题目、脑图混排，一屏一张，左右翻。
- 题库支持单选/多选/主观题，题目绑定知识节点。
- 有学科、章节、宫殿、单元/知识点、题目覆盖度等统计。

产品原则：**本地优先**。数据在本机 SQLite 和同步文件夹里，跨设备同步发生在应用之外（百度同步盘/F 盘等），同一时间只有一台设备写入。**不要设计云端后端、账号体系、公开 SaaS 或应用内同步**。

## 2. 技术栈与运行方式

- 前端：React 19 + TypeScript + Vite，PWA 与 Electron 桌面端共用同一套前端；Tailwind v4 风格 token。
- 后端：FastAPI + SQLAlchemy + SQLite，本地 `127.0.0.1:8012`；开发前端 `127.0.0.1:5173`。
- 数据根目录由 `local-config/memory-anki.local.json` 的 `local_app_home` 指定（每台机器不同，禁止硬编码盘符）。
- 测试：Vitest（前端单测）、Playwright（E2E，密封隔离）。
- 门禁：`python tools/quality_gate.py`、`--full`、`--launchers`。

## 3. 领域模型（与本需求相关）

```
学科 → 宫殿（思维导图）→ 章节 / 单元 / 知识点 → 复习单元（卡片）
```

- 复习单元有自己的排期状态：`stage_index`、`interval_days`、`due_date`、`has_passed`、`final_rating` 等。
- 评分四档：忘记 / 困难 / 记得 / 轻松；`passed = rating >= 2`。
- **学习日按凌晨 3 点翻页**：凌晨 3 点前算前一天。所有「今天」必须用项目的 `local_day` / `study_day_of`，不要用 `date.today()`。
- 已有成长数据：后端 `progression` 是**只读投影**，由评分、测验、学习时长回算 XP、等级、每日委托、印章；不写表、两台设备结果一致。
  - `GET /api/v1/progression/overview` 返回：等级/XP、委托、印章、stats，以及 `starmap`（每个宫殿的 `unit_count`、`learned_count`、`mastery_ratio`、`recall`、`due_count`、`stars`）。
  - 注意：这个接口会扫描全部评分历史，**很贵，不能每张卡请求**。目前前端没有任何页面消费它。
- 另有 `GET /api/v1/palaces/grouped`（宫殿列表、学科/章节分组，便宜）和 `GET /api/v1/dashboard/learning-progress`（知识树覆盖度，不含掌握度）。

## 4. 前端架构与硬规则

```text
apps/web/src: app → pages/widgets → modules/* → shared/platform
```

- 业务模块在 `apps/web/src/modules/<name>`，每个模块必须有 `module.yaml`（内容其实是 JSON）和 `public.ts`。
- 跨模块生产导入只能用 `@/modules/<name>/public`；`shared/` 不能导入 `modules/`；`domain/` 不能依赖 React、XState、`window.`、`document.`、`fetch(`。
- 新模块要在 `docs/architecture/context-map.yaml` 的 `runtime.frontendModules` 登记。
- 反馈统一走 `@/shared/fx` 的 `cue()`：只允许声音、触觉、CSS 果冻动画；**当前明确禁止粒子、canvas、WebGL 特效**；尊重 `prefers-reduced-motion`。
- E2E 密封：`apps/web/e2e/` 的 spec 必须从 `./fixtures` 导入 `test/expect`，不能连正在跑的 8012 服务。
- 单文件上限 750 行；lint 零警告；`python tools/quality_gate.py` 是迭代门禁。

## 5. 需求：学习城市

### 5.1 目标

在复习、翻卡、评分、做题、脑图编辑等**任何学习过程**中，都能看到一座随学习长大的等轴 2.5D 城市，提供成就感。

### 5.2 已确认的产品决策（用户原话/明确选择）

1. **必须随处可见**：用户的学习场景很复杂，随心模式、脑图编辑里都要能看到。
2. **三种形态**：
   - 全屏学习场景（随心、脑图、宫殿复习）→ 屏幕底部的「地平线」，只露屋顶，不遮挡内容，`pointer-events: none`；
   - 普通页面（今天、进度、宫殿列表）→ 右下角可收起的「小城窗」；
   - 点开或结算 → 全屏城，可环绕、缩放、平移。
3. **生长分档**：
   - 翻卡（看答案）：只起脚手架/亮一下，**不留永久建筑**（防刷）；
   - 评分：变化最大（升层/新建楼）；
   - 做题：小变化（铺路/路灯）；
   - 里程碑（升级、印章、攻克单元、一轮结束）：最大。
4. **视觉**：贴近现有「纸张暖光」调性（cream / amber / 低饱和），不是参考图那种高饱和 3D 渲染；后来用户又要求改用 Three.js，追求更接近参考图的质感。
5. **首版必须带结算生长动画**：一轮结束 → 镜头推进到本轮生长的街区 → 楼一栋栋升起。
6. **不做惩罚**：忘记不拆楼、不失火；最多窗暗、立「待修」牌。城市是产品里唯一只增不减的地方。

### 5.3 数据映射【判断，待用户确认】

- 学科 → 城区；宫殿 → 街区；单元/知识点 → 楼。
- 楼高只吃「已通过比例」（`learned_count / unit_count`，只增不减）；`mastery_ratio` / `recall` 只影响窗灯，**不能影响楼高**，否则忘记会拆楼。
- 印章 → 地标（钟楼/雕像）；等级 → 中心塔或城墙高度。
- 城市**不写数据库、不写 localStorage**（【判断】）：布局由宫殿/单元 ID 确定性生成，两台设备算出来一致；跨设备不传布局。

### 5.4 非目标（分清来源）

**【文档】项目明文写的：**

- 不做 XP 扣减、连续天数断档惩罚、排行榜。
  → `docs/architecture/progression.md:19`：「不做：XP 扣减、连续天数断档惩罚、排行榜。」
- 不做应用内文件同步/同步配置；同一时间只有一台设备写入。
  → `AGENTS.md:5`：「跨设备同步发生在应用之外；应用没有文件同步实现或同步配置。同一时间只有一台设备写入数据。」
  → `docs/architecture/README.md:17`：「本仓库是供两台设备使用的本地优先 Windows 产品……跨设备行为必须是确定性的，因为运行时数据在 Git 之外同步。」
- 不建公开 SaaS 后端、云端数据依赖、独立移动端。
  → `AGENTS.md:6`：「PWA 和桌面端使用相同的前端和本地后端。不要创建单独的移动应用、公开的 SaaS 后端或云端数据依赖。」

**【判断】本次的设计建议（不是项目既有规定）：**

- 不另建第二套经验值/养成系统，直接消费 `progression` 投影。
  理由：`progression` 已经是「由已记录的学习证据回算的只读投影」，再造一套会和它产生两处真相；`progression.md` 也要求恢复界面时新建前端模块，而不是复用旧的 `ceremony` / `cosmetics` 设计。
- 不做社交、好友、分享。
  理由：产品是私有双设备、无账号、无公开后端；这是由产品形态推出来的，**文档里没有明文禁止**。

## 6. 技术方向（已定）

用户明确要求：**Three.js + GSAP**。

- 等轴 Orthographic 相机 + OrbitControls；悬浮岛（草地/土壤/岩层）；InstancedMesh 渲染楼体/屋顶/树；平行光 + 阴影；ACES 色调映射。
- GSAP 负责楼层生长、脚手架、忘记闪色、金封顶、镜头推进、结算逐栋升起。
- 已做两个独立样张（未进项目）：
  - `deliverables/city-demo/`：纯 SVG/CSS 版（备选，体积小、零依赖）。
  - `deliverables/city-demo-3d/`：Three.js + GSAP 版（当前主推），源码 `src/part1..4.js`，esbuild 打成 `bundle.js`，Three/GSAP 已本地化。

## 7. 落地时必须处理

1. **改架构红线**：当前 `AGENTS.md` / `docs/architecture/fx-director.md` 禁止 WebGL/canvas。需要改成「反馈特效仍禁止；城市作为常驻场景层单独放行」，并在 `tools/check_architecture.py` 新增边界检查：WebGL 只允许出现在 `apps/web/src/modules/city`。
2. **懒加载**：three + gsap 只能进城市模块的懒加载 chunk，不进首屏；登记包体预算。
3. **单 renderer**：样张用了 3 个 WebGLRenderer（全屏/小城窗/地平线）。生产应改成一个 renderer + scissor/viewport 或离屏纹理，避免手机上开多个 WebGL 上下文。
4. **新模块** `apps/web/src/modules/city`：`module.yaml` + `public.ts` + `context-map.yaml` 登记 + 架构文档。
5. **数据请求策略**：`/progression/overview` 昂贵，只在应用启动后 idle、轮次结束、打开全屏城时刷新，至少间隔 60 秒；不要在评分/翻卡/做题时请求。实时生长用本地乐观事件，快照回来后以快照为准。

## 8. 现有可复用的事件（城市只需订阅，不改学习模块）

- 翻卡：`MINDMAP_CARD_LANDED_EVENT`（冒泡到 document，无 payload）。
- 做题：`GLOBAL_FEEDBACK_REQUEST_EVENT`，`quiz_result_correct` / `quiz_result_incorrect`。
- 评分（随心主路径）：`ratingSaveStore` 的 `acked` / `undone` 事件（模块内部，需要转成一个共享 app 事件）。
- 评分（旧路径）：`unitReviewApi.rateReviewUnitApi` / `ratePalaceDueUnitsApi` 成功回调，已 emit `reviewStateChanged`。
- 一轮结束：`cue('round.complete')` 的两个调用点（`freestyleRoundCelebration.ts`、`reviewCelebration.ts`）。
- 已有的 cue 名：`flip.land`、`grade.commit`、`unit.complete`、`round.complete`、`answer.correct`、`answer.wrong`。

## 9. 当前状态与待定项

- 两个样张都已做完并实跑（桌面 / 手机 / 离线），无控制台报错。
- **项目代码一行未改**，等用户确认质感后再落地。
- 待用户拍板：
  - 这个 3D 质感是否达标；
  - 楼宇密度（更密/更疏）；
  - 配色强度；
  - 默认镜头（近景街区 vs 全城）；
  - 结算镜头推进力度与时长；
  - 地平线高度、小城窗尺寸。

## 10. 请对方 AI 做什么

基于以上背景，给出「学习城市」的落地方案（模块划分、数据/事件接线、Three.js 场景与性能预算、结算时序、测试与架构门禁改动），并明确指出与现有架构冲突的地方。**不要建议云端、账号、应用内同步，也不要把成长系统重做一遍。**
