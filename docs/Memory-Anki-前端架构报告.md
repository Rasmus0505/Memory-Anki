# Memory Anki 前端架构报告

> 专项报告。总览见《[技术报告](Memory-Anki-技术报告.md)》，用户视角布局见《[前端布局](Memory-Anki-前端布局-用户视角.md)》。
> 本文讲前端**怎么组织、数据怎么流、状态放在哪、哪些边界不能破**。

---

## 1. 一句话模型

```text
app（壳/路由/Provider）
  → pages / widgets（页面组合）
    → modules/*（14 个运行时模块，统一 public.ts）
      → shared / platform / pwa（基础设施）
```

- 页面不写领域逻辑，也不直连后端；
- 业务模块不互相 import 私有实现；
- `shared` 不依赖 `app` 或业务模块；
- 跨模块组合只发生在 `pages` / `widgets`。

这套方向由 ESLint（`eslint-plugin-boundaries` + TypeScript resolver）和 `tools/check_architecture.py` 双重强制，lint 是**零警告契约**（`--max-warnings 0`）。

---

## 2. 目录职责

```text
apps/web/src/
├── app/            壳、Provider、路由装配、导航、命令面板
├── pages/          路由级页面（组合模块 public.ts）
├── widgets/        跨模块的页面级部件（如脑图复习流、做题窗口）
├── modules/        15 个业务模块，每个有 public.ts
├── platform/       浏览器副作用端口（全屏、存储、音频等）
├── pwa/            Service Worker 注册
├── shared/         跨功能基础设施（api、ui、fx、routing、persistence…）
├── test/           测试 setup
├── main.tsx
└── index.css
```

### 2.1 模块内部形态

不强制每个模块四层齐全，但常见形态是：

```text
modules/<name>/
├── domain/          纯类型、纯规则、实体
├── application/     用例、workflow（XState 只允许在这里）
├── ui/              组件与交互
├── api/             该模块的请求封装
└── public.ts        唯一对外入口
```

例如：

- `content/domain/mindmap-document-entity`：脑图文档纯规则；
- `practice/application/workflows`：随心训练状态机；
- `settings/domain/ai-runtime-entity`：AI 场景/模型选择。

---

## 3. 路由与导航元数据

### 3.1 单一来源

`shared/routing/routeManifest.ts` 是**路由 → 导航分区 / 页面历史分区 / 历史键 / 回退目标**的唯一来源。以下都从它派生：

- 侧栏/底栏的匹配器；
- 页面历史（返回/前进）的分区归属；
- 404 回退；
- 命令面板的目标。

JSX `<Routes>` 表仍然手写，但由 `routeManifest.test.ts` 对账，防止「路由加了、清单没登记」。

### 3.2 三种布局模式

路由元数据把页面分成三种壳层模式：

| 模式 | 页面 | 壳层行为 |
|---|---|---|
| `standard` | 书架、列表、做题、进度、洞察、设置 | 悬浮侧栏 + 有边距内容 + 氛围层 + 页面转场 |
| `mindmap` | 宫殿详情/编辑、知识树 | 侧栏贴边、内容铺满、页面不滚 |
| `immersive` | `/freestyle`、`/palaces/:id/review` | 无内容边距、无氛围层/转场、隐藏手机底栏 |

沉浸页仍属于 mind-map host（共享侧栏贴边规则），但会关掉环境层和页面转场。

### 3.3 分区记忆

每个导航分区会记住上次访问的 URL；再次点击当前分区标签会回到分区根。返回/前进被限制在当前分区内，不会跨区跳转。

---

## 4. 应用壳

`app/shell/AppShell.tsx` 负责：

- 桌面固定侧栏：品牌、时钟、版本徽标、主导航、设置、日志入口、返回/前进；
- 手机底部标签栏：主入口 + 「更多」底部抽屉；
- 内容区：按布局模式切换内边距、最大宽度、是否滚动；
- 全局能力：命令面板（`Ctrl/Cmd+K`、`?`、`Ctrl+N`、`/`）、后台任务条、日志抽屉、会话录制浮标；
- 首屏预热：预加载练习路由、书架、编辑器等 chunk，但不在启动阶段抢目录数据。

### 4.1 侧栏宽度

- 手机（<768）：无侧栏；
- 平板/小窗（768–1024）：图标栏（`5.5rem`）；
- 桌面（≥1024）：完整栏（`14.75rem`），可收成 `4.75rem`。

### 4.2 路径预加载

鼠标悬停/聚焦导航项时预热对应模块；随心页还会预加载画布 chunk。目的不是「提前请求数据」，而是避免点击后停在空壳上。

---

## 5. 数据请求层

### 5.1 Query 配置

`shared/api/queryClient.ts`：

- `staleTime = 30s`；
- `gcTime = 10min`；
- 窗口重新聚焦不自动刷新；
- 失败重试 2 次，指数退避 1s → 2s → 4s（封顶 8s）。

读取模型以 TanStack Query 为主；轮次/卡片这类高频交互状态不放进全局 query cache。

### 5.2 HTTP 客户端

`shared/api/http.ts` 是所有请求的统一入口：

- `API_BASE = /api/v1`；
- 每个请求带 `X-Request-ID`，与后端日志行对齐；
- 写请求带 `X-Memory-Anki-Mutation-ID`；
- 读请求 20s 超时：半开连接（手机休眠、Tailscale 重连、后端重启）会变成可见、可重试的错误，而不是永远骨架屏；
- 写请求默认**不设超时**：请求已发出时，超时只会让客户端和服务端状态分裂；唯一的例外是显式 `timeoutMs` 且不入队的写请求（如随心会话启动 45s）；
- 本地 GET 对低信息网络错误做 250ms / 750ms 两次重试；
- 响应带 `request_id`，错误对象保留状态码、业务码和消息。

### 5.3 写入队列

`shared/persistence/mutationQueue.ts` 基于 IndexedDB：

- 失败写入持久化，刷新/重启后可重放；
- 支持 `coalesceKey` 合并同一实体的连续写入；
- 支持 `replayMode: auto | manual`；
- 与页面状态解耦，页面可以卸载，队列仍然存在；
- 对冲突响应有明确分类，不把 409 当成普通失败。

### 5.4 乐观并发

轮次/评分类写入携带 `expected_version` 和 `operation_id`：

- 过期设备收到 `conflict` 和最新状态；
- 同一 operation 的重复终态写入返回已接受结果；
- 本地 reducer 先打补丁，服务器确认后采用权威状态；
- 冲突不会静默覆盖另一台设备的进度。

---

## 6. 客户端持久化

| 存储 | 内容 | 生命周期 |
|---|---|---|
| TanStack Query 内存缓存 | 读取模型 | 页面会话 |
| IndexedDB `mutationQueue` | 未确认的写请求 | 跨刷新/重启 |
| IndexedDB 草稿槽 | 脑图编辑草稿（每文档单槽覆盖） | 跨刷新/关页 |
| IndexedDB `versionedCacheStore` | 带版本的缓存 | 按版本淘汰 |
| `localStorage` | 客户端偏好、窗口布局、随心显示偏好、城市窗口状态 | 设备本地 |
| 服务端 SQLite | 学习账本、排期、轮次计划、题目进度 | 权威 |

硬规则：

- 浏览器存储**不得决定复习顺序**；轮次顺序以服务端计划为准；
- 翻卡/展开进度不写 localStorage，不跨访问记忆；
- 编辑草稿只有基线匹配服务端 revision 才能自动回写，否则进入显式冲突；
- 清除/墓碑按单调时间戳排序，延迟清除不能删掉更新的作答。

---

## 7. 脑图前端架构

### 7.1 分层

```text
纯文档实体（content/domain/mindmap-document-entity）
        ↓
通用画布（shared/ui/mindmap-canvas，懒加载 xyflow）
        ↓
编辑器运行时（content/ui/mindmap-editor）
        ↓
显式 capability（业务装饰/动作）
        ↓
业务宿主（宫殿编辑、知识树、复习、随心）
```

- 文档实体不依赖 React / React Flow / 业务 feature；
- 通用画布不出现 palace / segment / mastery / review 字段；
- 编辑器运行时不直接访问业务 API；
- 业务宿主通过 `MindMapPersistenceAdapter` 提供加载/保存，通过 `MindMapCapability[]` 提供装饰和动作。

### 7.2 展示状态机

`mindMapPresentationMachine` 明确区分：

- `embedded`；
- `requestingNativeFullscreen`；
- `nativeFullscreen`；
- `viewportFullscreen`；
- `exitingFullscreen`。

原生 Fullscreen API 被拒绝时只能进入视口全屏，不能继续上报为系统全屏。桌面默认 `native-preferred`，已安装 PWA 默认 `viewport-only`。

### 7.3 自动保存与草稿

- 每次完整编辑动作立即保存；HTTP 约 800ms 防抖，单飞；
- 在飞期间的后续编辑进入 `pendingSnapshot`，当前保存成功后必须再发一次（不依赖组件仍挂载）；
- 编辑即写 IndexedDB 草稿（同 key 覆盖），新草稿保留真实基线快照与指纹；
- 关页 `visibilitychange` / `pagehide` 刷新草稿；
- 冲突解决前必须把本地/远端快照写入独立归档并等待事务完成；
- 保存响应只更新指纹/状态，不用它重建本地文档。

### 7.4 性能热路径

- `getNodeSize` 必须走 `nodeSizeMemo`：900 节点时单次布局约 15ms，重复度量会吃掉整帧；
- 翻卡手势期间关闭节点 left/top 和边 `d` 的布局弹簧（`data-reveal-motion`），否则点击会被动画吞掉；
- 含活导图的卡片退出 `.fs-depth` 的滚动联动变换，避免每帧重合成整棵画布；
- 画布就是页面：默认铺满宿主，无圆角/外投影；对话框里的预览才显式加 `is-inset`。

这些都有对应的架构门禁，不是「优化建议」。

---

## 8. 随心前端架构

### 8.1 权威状态

- 后端轮次计划是唯一权威；
- 前端 reducer 应用乐观补丁，并从服务器注入状态；
- 刷新、重启、切设备不铸造新 `round_id`；
- 只有显式「再来一轮」才调用 `/rounds/start`。

### 8.2 进度内核

`unitProgressState` 拥有 occurrence 局部的本轮评分：

- `occurrenceScore` / `isOccurrenceScored` / `isOccurrencePassed` / `findEarliestUnscoredIndex`；
- 进度条填充、「完成」查找、宫殿清空、轮次完成都必须读它；
- 调用点不得自己拼 `selectedRating` / `lastRating` / `completedIds`。

`roundCompletion` 在其上叠加一条家族规则：

- 重练已通过的源卡片，即使自身薄弱评分掉出本地账本，也算完成；
- 空白重练已经出现的源卡片会被跳过；
- 方向是**源 → 重练**，重练绝不从源继承完成/评分。

### 8.3 重练 occurrence

- 「忘记」创建一个 pending occurrence，`available_at` 之前不出现；
- 到点后服务端读取时发布，位置在当前游标处；
- 重练有自己的 `encounter`，从空白开始；
- 一次只有一个活跃重练；再次忘记会重开同一个 occurrence 并递增 `retry_attempt`；
- 前端**不自己插卡**，只在源卡角标和横幅显示倒计时。

### 8.4 评分保存

- 点击立即上屏，保存异步；
- 只有服务器确认后才更新完成数、通过数和重练排期；
- 保存失败保留选中按钮并显示「未保存」，再点一次重试；
- 快速翻卡/进度条跳转不会为只是被翻过的卡片打开浏览；
- 评分响应合并进本地账本，**不重建队列**，避免眼前卡片闪烁和进度条重算。

### 8.5 滚动与键盘

- 信息流是 `snap-y snap-mandatory` 的纵向吸附容器；
- 滚轮每格翻一张卡，触控板惯性合并；
- 手指翻页只在滚动稳定后提交 `active`；
- 空格留给卡片内输入，不翻页；
- 编辑会话打开时（`data-mindmap-editor-active`），所有翻页/翻卡/评分键暂停。

### 8.6 状态机

`freestyleTrainingMachine` 只有两个状态：

- `training`：接收 `ROUND_SYNCED` / `SCROLL_SETTLED` / `ROUND_COMPLETE_REQUESTED`；
- `completed`：接收 `ROUND_RESTARTED` / `ROUND_SYNCED`。

完成守卫 `canCompleteRound` 是纯领域函数，**拒绝由滚动驱动的完成**。

---

## 9. 做题前端

- 题目作答是题目自己的证据，不写宫殿复习评分；
- 所有入口共享同一份题目进度（工具栏、节点徽标、随心叠加层、随心做题卡）；
- 刷新不清除已做；只有手动清空或结算页选择清空才清除；
- 做题窗口与节点关联题窗口共享题目元信息行，但数据源独立；
- 「本轮最低 N / 本轮尚未复习」徽标由统一组件读取轮次评分，窗口不得自行推导；
- 题目发布状态不再是练习门槛。

---

## 10. 反馈与主题

### 10.1 `shared/fx`

- 业务代码只调用 `cue()`，声明「发生了什么」；
- 配方决定声音、触感、CSS 果冻、DOM 小动效；
- 延迟步骤挂在 `FxPlayback` owner 上，owner 退役即取消；
- 禁止粒子、canvas 特效（学习城市地平线的隔离 iframe 除外，见 `docs/architecture/city.md`）、业务代码直接 WebGL/WebAudio。

### 10.2 音频与主题

- `shared/feedback/mindmap-audio`：程序化合成音色、音色池、AudioContext 生命周期、iOS 解锁、静音分区、场景音量门；
- `shared/theme`：单一 `study` 主题包（翻页/翻开时长、theme-color），不随成长解锁。

### 10.3 视觉令牌

- 唯一来源：`src/styles/foundation.css` 的 `@theme`（浅色）与 `.dark`（深色）。组件只用令牌类（`bg-card`、`text-muted-foreground`、`shadow-card`…），不写字面色值。
- 基调：冷石板灰（色相 228）中性色 + 靛紫主色（色相 236–240）。三层明暗：页面 `background` < 容器 `card` < 浮层 `popover`；深色模式下三层都是灰，靠 1px 上沿高光和阴影区分。
- 语义色：成功 / 警告 / 危险 / 信息各有 `*-soft`（低饱和底）与 `*-strong`（高对比字），徽章与提示条用这对组合；评分四色 `rate-again/hard/good/easy` 不跟主色走。
- 字体：Latin 用系统无衬线（Apple 系统字体 / Segoe UI），中文 PingFang SC → 内置 Noto Sans SC → 微软雅黑。数字列、计时、进度用 `tabular-nums`。
- 圆角：6 / 8 / 10 / 14 / 20px（`rounded-sm` … `rounded-2xl`），按钮 8–10px，卡片 14px，对话框 20px。
- 阴影：一层贴边接触影 + 一层大半径弥散影；`shadow-glow` 只给主按钮悬浮。
- 交互：按钮悬浮上浮 1px、按下 `scale(0.97)`、键盘聚焦 2px 主色环；过渡统一 `cubic-bezier(0.16, 1, 0.3, 1)`，约 0.2s。全局聚焦环放在 `@layer base`，组件自带的 `focus-visible:*` 可以覆盖它。
- 固定保留的含义色：警告/困难的琥珀、考试三星的金框、脑图荧光笔黄、学科自定义色、永久标记分级色、城市待修牌橙色。重新调色时不要把它们并进主色。
- 已移除：窗光、时段色调、纸张颗粒、跟随鼠标的暖光、卡片 3D 倾斜、进度条循环光泽。考前两周的屏幕边缘呼吸保留。
- 字号下限：要读的字不小于 11px；画在固定小圆里的计数徽标、折叠钮、进度刻度例外。
- 页面层级：常规 `PageHeader` 不套卡片，标题直接在页面底色上；只有 `compact` 版（脑图页）保留卡片外框。视图切换统一用 `ToggleGroup`（单选，`role="radio"`），布局选项只放图标、名字在 `aria-label` / `title`。
- 侧栏结构：`MindMapSplitLayout` 不再渲染「只放一个按钮的 rail 列」。面板标题行放 `SplitPanelToggle`（通过 context 拿到收起状态，并向布局登记，布局就不再画角落兜底按钮）；收起后只剩画布边缘一个竖向小标签；`railMode="never"` 表示宿主自己画开关。收起的面板加 `inert`，Tab 不会进到看不见的按钮里。`surface="inset"` 给对话框里的分栏用，不铺 card 底色。
- 导航 + 目录：mind-map host（含随心）默认把主导航收成 3.5rem 图标栏（`hostNavExpanded` 只在这次访问里有效），让导航和页面目录读成一条侧栏；图标栏里的导航链接带 `aria-label` / `title`。
- 书架树：`PalaceCatalogTree`（`modules/content/ui/palace-catalog`）把 `/palaces/grouped` 转成 `PalaceDirectoryTree` 的树（`buildPalaceCatalogTree`，宫殿留在 grouped 接口归的章节里，按 `parent_id` 嵌套），再用 `PalaceDirectoryTreeView` 的 `size="page"` 渲染，行尾内容走 `renderSubjectMeta / renderChapterMeta / renderPalaceMeta / renderBucketMeta`。书架页和学科页共用这一棵树，原来的卡片、布局/密度设置和视图抽屉已删除。
- 调试工具：录制、日志抽屉、版本号都在 `SessionRecorderMenu`（`shared/debug/session-recorder`）里，壳层用 `ShellToolsMenu` 把日志和版本挂进去。桌面在侧栏底部，手机在顶栏右侧，沉浸页由 `SessionRecorderHost floating` 浮在右上角。菜单的触发器和内容都带 `data-session-recorder`，不会被当成「上一次点击」。

---

## 11. PWA、Electron 与多端

### 11.1 PWA

- 与桌面同一套前端；
- Service Worker、离线页、manifest 在 `public/`；
- 安装后全屏是「占满可视视口」，不承诺隐藏系统状态栏；
- Tailscale Serve 只做私有转发，不开 Funnel；
- 构建失败时后端会继续 serve 旧包，所以排查白屏先看构建日志和 index hash。

### 11.2 Electron

- 只加载 `127.0.0.1:8012`；
- 负责窗口、重试加载、外链、少量 IPC；
- 不内嵌业务代码，不单独打包前端。

### 11.3 多端进度

- `GET /session/live/stream`（SSE）+ `POST /session/live/commands`；
- 投影只在进程内存，不写数据库；
- 设备保留自己的路由、当前卡片、翻卡状态；
- 控制器通过显式 `take_control` 获得，租约 8s；
- 评分镜像到另一端，但跟随端不重复发评分 POST。

---

## 12. 构建与产物

### 12.1 Vite 配置的关键点

- vendor 分组有白名单（react、radix、icons、sonner 等），**不**做会把 CJS interop 吸进入口的强制分组；
- `cmdk` 不强制分组，跟随懒加载自然成为异步块；
- 构建写 release manifest，清理脚本按清单保留最近产物；
- 对 `PalaceEditPage`、`useMindMapImport` 写稳定 chunk 别名，滚动更新时旧页面不会 404；
- dev HMR 通道保留；源码热更新触发的手动刷新被拦截，依赖预构建的整页刷新放行（否则会出现两份 React）；
- `MEMORY_ANKI_E2E=1` 时移除 `/api` 代理，E2E 永远碰不到 8012 真实数据。

### 12.2 路由级懒加载

页面按路由懒加载并配合 `preload*` 函数预热；加载失败有重试包装，避免一次 chunk 失败把整个应用打空。

---

## 13. 测试与前端门禁

- Vitest：393 个测试文件（组件、模型、reducer、hook）；
- Playwright：10 个 spec，三个 project（桌面 Chromium、Pixel 7、iPhone 15）；
- E2E 必须从 `./fixtures` 导入 `test`/`expect`，未 mock 的 `/api` 返回 503；
- Service Worker 在 E2E 中阻断；
- `reuseExistingServer: false`，绝不指向正在运行的 8012；
- 架构门禁检查：public.ts 纪律、路由清单一致性、共享存储门面、FX 边界、音色默认、主题注册、E2E 封闭、生成 API 边界、超大文件基线等。

---

## 14. 维护建议

1. **新页面先登记路由清单**，再写 `<Routes>`；否则导航、历史、回退会分叉。
2. **跨模块能力先加 public.ts 导出**，不要在页面里 import 对方私有文件。
3. **交互状态优先放模块内部**，不要为了「全局方便」把轮次/评分塞进全局 store。
4. **写入必须可重放**：新写接口默认接 mutation queue，除非明确不需要（并说明为什么）。
5. **异步实体作用域工作必须带 owner/operation**，否则过期请求会更新另一个实体。
6. **拆文件优先于加 baseline**；baseline 只减不增。
7. **动效/声音/触感一律走 `cue()`**，不要在组件里直接 `setTimeout` 或 `AudioContext`。
