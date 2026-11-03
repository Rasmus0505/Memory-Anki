# 学习城邦浮窗（city）

> 前端模块：`apps/web/src/modules/city`。隔离场景资产：`apps/web/public/city`。
> 场景原型源文件：`deliverables/2026-11-04-记忆城邦-2.5D悬浮小城.html`（嵌入版发布为 `public/city/index.html`，修改场景时两处需同步）。

## 形态

- **React 只负责窗口**：拖拽、缩放、最大化、收起、关闭/重开、位置与尺寸持久化、静音、镜头环绕、重置视角、演示按钮、实时指标。窗口默认关闭，右下角一个「记忆城邦」启动胶囊；首次打开后 iframe 保持挂载，关闭窗口不会丢失城邦状态。
- **Three.js 只在同源 iframe 中运行**：`public/city/index.html?embed=1`。React 包不导入 `three`/`gsap`，首屏包体不增加；iframe 在首次打开时才加载。
- **紧凑固定城邦**：10×10 悬浮岛，2 条主干道 + 2 条支路，主塔 / 阶梯公寓 / 低层斜顶屋 / 右侧摩天轮公园 / 一处塔吊工地。场景内无扩岛，积累通过楼层生长、细节叠加、空中连廊、屋顶花园与钟塔/天文台呈现。
- **离线资源**：`public/city/vendor/` 本地化 Three.js 与 GSAP；嵌入模式优先本地，缺失时才回退 CDN。

## 真实学习事件映射

城邦是只读可视化，不写学习/排期数据，也不按卡片请求 `/progression/overview`。

| 来源 | 事件 | 城邦反馈 |
|---|---|---|
| 翻卡落地 | `memory-anki:mindmap-card-landed`（document 冒泡） | 五声音阶翻卡连击、构件落位、全城微共振 |
| 四档评分 | `memory-anki-global-feedback-request` 的 `grade_forget/hard/good/easy` | 1 忘记（信标+无人机）/ 2 平房 / 3 多层 / 4 地标+连廊 |
| 做题 | 同上事件的 `quiz_result_correct/incorrect` | 答对点亮暖窗、发车、摩天轮加速、热气球；答错只给低音提示，不拆楼 |
| 编辑脑图 | 同上事件的 `node_create/node_delete/node_move/text_commit/save_success` | `pin/structure/detail`，700ms 节流 |
| 标重点 | `review-unit-favorite:changed` 且 `isFavorite` | 选中建筑金色重点屋顶 + 旋转星芒 |
| 一轮结束 | 应用事件 `round-completed`（`reviewCelebration` 与随心轮次完成处发出） | 庆祝和弦、光环与热气球 |

所有事件通过 `postMessage` 进入 iframe；iframe 以 `stats` / `notice` / `audio` / `ready` 回传。队列上限 30 条，iframe 就绪后以 90ms 间隔回放最近事件。

## 数据与持久化

- 窗口位置、尺寸、开合、静音、环绕状态保存在浏览器 `localStorage`：`memory-anki:city-window`。这是设备本地的窗口偏好，不进入同步数据。
- 城邦场景本身**不写 localStorage、不写数据库**；页面刷新后从预置城邦重新开始。历史进度回灌（用 `progression` 投影播种）是后续工作。
- e2e 统一设置 `memory-anki:city-disabled=1`，避免浮窗遮挡既有测试目标；单元测试环境下组件直接返回 `null`。

## 边界与不变量

- 城邦是唯一允许 Three.js/WebGL 的前端表面，且必须留在 `public/city` 的 iframe 内。React 源码不得导入 `three`/`gsap`；`shared/fx` 的 WebGL/粒子禁令不变。
- 城邦只消费事件，不写学习数据、不触发评分/排期写入。
- 事件桥对编辑类动作节流；翻卡/评分/答题是高频但用户驱动的动作。
- 音效在 iframe 内合成；浏览器要求 iframe 内一次点击后才可播放，窗口会提示「点击城邦画面开启音效」。
- Service Worker 对 `/city/` 直接放行，避免 SPA 导航兜底把城邦 iframe 换成应用外壳；因此真正的离线冷启动下城邦可能加载失败，应用主体不受影响。

## 测试

- `src/modules/city/model/cityEvents.test.ts`：事件到城邦指令的纯映射（四档、答题对错、脑图编辑/微交互过滤）。
- Playwright 手动冒烟：打开浮窗 → iframe ready → 拖拽/缩放 → 在文档派发翻卡与评分事件 → 头部指标变化 → 关闭/重开状态保留。
- 架构门禁：`tools/check_architecture.py` 检查模块登记、public 入口、城邦资产存在，以及 React 源码没有直接 three/gsap 导入。
