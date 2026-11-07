# Impeccable 24 命令运行手册

> 目标：按 SKILL.md 的命令表顺序，把 impeccable 的 24 个命令各跑一次。
> 每条记录：目标界面、依据的 reference、实际动作、结论/产物。
> 项目：Memory Anki（考研记忆宫殿 + FSRS 翻卡）。
> 运行环境：`.claude/worktrees/impeccable`，分支 `impeccable`，开发服务 `http://127.0.0.1:5175`。
> 最后更新：2026-11-08。

| # | 命令 | 组 | 目标 | 产物 / 结论 |
|---|---|---|---|---|
| 1 | craft | Build | 全站视觉重建 | 弃用别名，走 new-work 流程（PRODUCT.md + DESIGN.md + 实现） |
| 2 | shape | Build | 随心结算页 | `docs/design/surfaces/round-settlement.md` |
| 3 | init | Build | 产品事实 | `PRODUCT.md` 升级到 product-schema 1 |
| 4 | document | Build | 视觉系统 | `DESIGN.md` 升级为 DESIGN.md 规范（YAML + 8 节） |
| 5 | extract | Build | 账本行 / 统计行 | `shared/components/ui/ledger.tsx`，迁移 2 处 |
| 6 | critique | Evaluate | 随心开始页 | 双代理评审，20/40；`docs/design/critiques/2026-11-08-freestyle-start.md` |
| 7 | audit | Evaluate | 学科书架 / 洞察 | 18/20；`docs/design/audits/2026-11-08-shelf-insights.md` |
| 8 | polish | Refine | 学科书架 | 搜索框可访问名、长查询与展开态实测 |
| 9 | bolder | Refine | 结算页 | 本轮数字升到 64/76px 衬线，去掉 kicker |
| 10 | quieter | Refine | 洞察热力图 | 深色高亮档降一级 |
| 11 | distill | Refine | 英语片库 | 删掉三格统计带，改成一行元信息 |
| 12 | harden | Refine | 随心开始 / 输入 | 加载态说真话、焦点陷阱、placeholder 对比度 |
| 13 | onboard | Refine | 空书架 | 三步心智模型 |
| 14 | animate | Enhance | 洞察到期数 | 数字滚动一次 |
| 15 | colorize | Enhance | 考试各科进度 | 学科色进入进度条 |
| 16 | typeset | Enhance | 设置页 | 17px 卡片标题、68ch 测量、pretty 换行 |
| 17 | layout | Enhance | 书架工具行 | “全部收起”变成有边界的同排控件 |
| 18 | delight | Enhance | 结算页 | 朱砂完成印记 + 压印动效 |
| 19 | overdrive | Enhance | 结算结果 | 墨渗（mask radial）揭示数字 |
| 20 | clarify | Fix | 翻卡文案 | 去掉重复提示，补“本轮还剩 N 个” |
| 21 | adapt | Fix | 极窄手机 | <380px 指标改单列 |
| 22 | optimize | Fix | 首屏 CSS | 英语样式从全局 CSS 拆到英语路由 chunk |
| 23 | live | Iterate | 随心开始按钮 | live 配置 + 注入 + 浮层 + 轮询 + 关闭 |
| 24 | generate | Iterate | 书架学科行 | 3 个结构变体对比，保留 A |

---

## 逐条记录

### 1. craft（弃用别名）

- reference：`reference/craft.md`（5 行）。
- 动作：确认它只是普通“做新视觉工作”的别名；本项目的新世界已按 `new-work.md` 建立（PRODUCT.md → 方向 → 实现）。
- 结论：无需单独产出；记录为已执行。

### 2. shape

- reference：`reference/shape.md`。
- 目标：随心结算页（`FreestyleRoundSettlement`）。
- 动作：按 Phase 1/3 写不含代码的设计简报：受众、成功标准、方向、边界、状态、交互、开放决定。
- 产物：`docs/design/surfaces/round-settlement.md`。
- 说明：简报基于代码与产品事实推断，两个开放决定留给用户确认。

### 3. init

- reference：`reference/init.md`。
- 动作：把已有 PRODUCT.md 升级为 `impeccable:product-schema 1`：Platform / Users / Product Purpose / Positioning / Operating Context / Capabilities and Constraints / Brand Commitments / Evidence on Hand / Product Principles / Accessibility。
- 结论：产品事实全部有仓库证据；没有做新的用户访谈（用户已授权自主完成），推断项已在文中标为约束而非用户原话。

### 4. document

- reference：`reference/document.md`。
- 动作：把 DESIGN.md 升级为官方格式：YAML frontmatter（颜色、字体、圆角、间距、组件）+ 8 个固定章节（Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts）。
- 结论：token 是 normative，正文解释用法；已核对对比度数字。

### 5. extract

- reference：`reference/extract.md`。
- 发现：同一“标签在左、衬线数字在右、行间发丝线”的统计行在洞察与热力图重复出现（6 个行实例）。
- 动作：新增 `apps/web/src/shared/components/ui/ledger.tsx`（`Ledger` / `LedgerRow`，`size: sm|md`，`tone: default|mark`），迁移 `ExamDashboardDigest` 与 `StudyHeatmap`。
- 结论：账本行成为共享模式；没有为一次性样式造抽象。

### 6. critique

- reference：`reference/critique.md`。
- 动作：两个隔离代理并行——A 设计评审（10 项启发式、认知负荷、情绪旅程），B 检测器 + Playwright 证据；父线程只做综合。
- 结果：20/40；设计专属性偏通用；P1 是加载态谎报、焦点逃逸、placeholder 3.5:1。
- 产物：`docs/design/critiques/2026-11-08-freestyle-start.md`；快照写入 `.impeccable/critique/`。

### 7. audit

- reference：`reference/audit.md`。
- 动作：5 维技术审查（a11y / 性能 / 主题 / 响应式 / 实现完整性），实测 390 与 1440 的滚动宽度、触控目标、可访问名称、标题层级；跑检测器。
- 结果：18/20；P1 是书架搜索框没有可访问名称；P2 是行内链接 20px 高（WCAG 豁免）与深色热力图偏亮。
- 产物：`docs/design/audits/2026-11-08-shelf-insights.md`。

### 8. polish

- reference：`reference/polish.md`。
- 目标：学科书架全路径。
- 动作：
  - 搜索框补 `aria-label="搜索学科或宫殿"`（关闭审计 P1）。
  - 实测 390px 下输入超长查询：`scrollWidth === innerWidth`，无横向溢出、无控制台错误。
  - 展开“843”核对嵌套行、悬停与分隔线；无卡片套卡片。
- 结论：路径完整；未修改数据或行为。

### 9. bolder

- reference：`reference/bolder.md`。
- 目标：结算页（只动这一块）。
- 动作：本轮数字从 30/36px 无衬线升到 64/76px 衬线；去掉“本轮完成”的宽字距小标题，改成 12px 普通标签；三格统计改用衬线数字。
- 结论：数字成为页面的峰值，其余元素安静下来；没有新增颜色或字体。

### 10. quieter

- reference：`reference/quieter.md`。
- 目标：洞察热力图（只动深色）。
- 动作：深色下四档透明度各降一级（100→80、80→65、55→45、30→25），浅色不变。
- 结论：热力图退回背景纹理，不再比“今天该学什么”更亮。

### 11. distill

- reference：`reference/distill.md`。
- 目标：英语片库。
- 动作：删掉“课程 / 未完成 / 已完成”三格并排统计带（与片库内容重复），改成片库标题下的一行 `共 N 门 · 未完成 N · 已完成 N`；删除不再使用的 `Stat` 组件与 `.ed-library__stats` / `.ed-stat` CSS。
- 结论：少一整个横向区块，信息仍然可达。

### 12. harden

- reference：`reference/harden.md`。
- 目标：随心开始页与全局输入。
- 动作：
  - 首次加载不再说“暂无需要学习的内容”：显示“直接开始学习”，概览落定后再判断空态。
  - 开始浮层补 `role="dialog" aria-modal="true" aria-label`，打开时聚焦“开始学习”，Tab 在浮层内循环。
  - 输入框 placeholder 从 `muted-foreground/80`（约 3.5:1）改为完整 `muted-foreground`（4.96:1）。
  - 概览里的昨日薄弱项改成与回顾卡同一种行式排版，不再用红色 pill。
- 结论：加载、键盘、低对比三条硬化完成；控制台仍有一个客户端轮次 ID 的 400 噪声（数据层，非本次范围，已记录）。

### 13. onboard

- reference：`reference/onboard.md`。
- 目标：空书架。
- 动作：标题改为“先从一本书开始”，正文用三步说明“建宫殿 → 写节点 → 回随心翻卡”，主按钮仍是“创建第一个宫殿”。
- 结论：空态承担第一课，而不是只说“还没有”。

### 14. animate

- reference：`reference/animate.md`。
- 目标：洞察“今天该学什么”的到期数。
- 动作：用共享 `RollingNumber`，数字落定时滚动一次；`prefers-reduced-motion` 与 jsdom 下直接显示终值。
- 结论：全页只增加这一个有含义的动效，不加入场编排。

### 15. colorize

- reference：`reference/colorize.md`。
- 目标：考试作战室“各科进度”。
- 动作：进度条从统一绿色改成学科色（预测段用 24% 混合、掌握段用原色），色标从圆点改为 2px 圆角方标。
- 结论：颜色用来区分身份，语义仍由长度表达。

### 16. typeset

- reference：`reference/typeset.md`。
- 目标：设置页“复习与偏好”。
- 动作：卡片标题 16→17px、字距 0.01em；长说明限制 68ch、行高 1.75、`text-wrap: pretty`。
- 结论：标题、正文、标签三级在扫读时可区分；正文测量不再横跨整张卡。

### 17. layout

- reference：`reference/layout.md`。
- 目标：书架搜索行。
- 动作：“全部收起”从无边界 ghost 图标改成 outline 控件，与搜索框同高（36px），桌面显示文字、手机只留图标。
- 结论：工具不再是浮在空白里的图标，和搜索框形成一条对齐的工具行。

### 18. delight

- reference：`reference/delight.md`。
- 目标：结算页完成时刻。
- 动作：奖杯右下加一枚朱砂圆形对勾印记，1.05s 后压印进入（scale 1.6 → 0.94 → 1，带轻微旋转）；reduced-motion 下静态。
- 结论：一个小而有记忆点的“已完成”，不使用彩带或烟花。

### 19. overdrive

- reference：`reference/overdrive.md`。
- 目标：结算结果数字。
- 动作：用 `@property --fs-ink-r` + 径向 mask 让数字像墨渗进纸一样展开（0% → 120%，1.15s）；不支持 `@property` 的浏览器直接显示完整数字。
- 结论：一个与纸墨世界绑定的技术时刻，而不是通用闪光。

### 20. clarify

- reference：`reference/clarify.md`。
- 目标：随心开始页文案。
- 动作：删掉两个指标下重复的“宫殿 / 复习单元”（只留一次）；开始按钮上方补“本轮还剩 N 个单元”或“按今日到期顺序开始”；加载文案改成“直接开始学习”。
- 结论：同一件事只说一次；按钮的后果可预期。

### 21. adapt

- reference：`reference/adapt.md`。
- 目标：极窄手机（<380px）。
- 动作：随心开始页的两项指标在 <380px 改为单列，分隔线从竖线改为横线；40px 数字无需缩小。
- 结论：320–379px 不再有挤压风险；390 与 1440 保持原布局。

### 22. optimize

- reference：`reference/optimize.md`。
- 目标：首屏 CSS。
- 动作：把 `english-dictation.css` 从全局 `index.css` 拆出，改由英语路由的两个入口导入；Vite 将其打进英语 chunk。
- 结果：全局 CSS 512K → 476K（-36K，约 -7%）；英语路由首次进入多一个 40K 样式块。
- 回归：拆分后首轮截图发现听力页未带样式（`EnglishDictationLibrary` 的导入未落位），补上 side-effect import 后复查恢复；英语测试 65 条通过。
- 说明：>500K 的 JS chunk 是历史问题，未动分包（避免 rolldown vendor 分组把 CJS interop 吸进首屏的已知坑）。

### 23. live

- reference：`reference/live.md` + `live-setup.md`。
- 动作：
  - 写入 `apps/web/.impeccable/live/config.json`（`files: ["index.html"]`，`insertBefore: </body>`，`cspChecked: true`）。
  - `impeccable live --target apps/web` 启动 helper（8400），发现 3 个 public HTML 不在配置内（configDrift，已记录，不自动改）。
  - 在预览页注入 `live.js`，确认浮层（highlight / tooltip / 工具条）挂载，页面与 helper 连接（connectedClients: 1）。
  - 启动 `live-poll`，确认轮询通道工作；无待处理事件。
  - `live-server stop` 关闭并移除注入。
- 结论：live 通道可用；没有留下注入脚本或源码标记。

### 24. generate

- reference：`reference/generate.md`。
- 目标：书架学科行（3 个变体）。
- 动作：生成并渲染三个结构变体——A 目录行（现状：色标 + 衬线名 + 右侧计数）、B 两行（名字 + 元信息）、C 索引（编号 + 引导点）。
- 结论：保留 A。B 把行高翻倍、8 个学科时密度不够；C 的编号没有信息价值（craft-floor 也反对装饰性编号），引导点增加噪声。A 已同时满足身份、计数与到期徽标。
- 产物：`tmp/impeccable-shots/variants-shelf.html` + 截图。说明：本轮无人现场选择，因此以静态变体页完成“生成—对比—保留一个”，并单独用 live 通道验证了浏览器内变体基建。

---

## 验收

- 前端测试：全量 2755 通过；拆分修复后英语子集 65 条再次通过。
- `tsc -b --noEmit`：通过。
- 生产构建：通过。
- 架构门禁：通过。
- 检测器：25 条，1 条 warning 是“遮住答案”的功能性渐变，其余为弹簧缓动 advisory。
