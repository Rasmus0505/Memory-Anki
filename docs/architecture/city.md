# 学习城市地平线（city）

> 前端模块：`apps/web/src/modules/city`。隔离场景：`apps/web/public/city/horizon.html`。
> 后端读模型：`GET /api/v1/dashboard/city-today`（`modules/dashboard/application/city_today.py`）。
> 原型：`deliverables/city-prototype/`（`palace.html` 是本形态的样张，`index.html` 是全屏城的玩法样张）。

## 形态

- **今天这座岛**：一个学习日（凌晨 3 点翻页）一座岛。今天评过分的每座宫殿是一栋楼，按今天第一次评分的先后从左到右排。
- **一卡一窗**：窗户按宫殿的卡数开，每层 4 扇，最多 24 扇（卡多时几张卡共用一扇）。今天评过的卡从下往上点亮，亮度跟最近一次评分：忘记暗、困难微亮、记得亮、轻松最亮。
- **待修牌**：今天有卡最近一次是「忘记」，门口立橙色牌子；再评过就摘。不拆楼。
- **金屋顶**：这座宫殿的卡今天全部评过一遍。
- **当前宫殿**：在 `/palaces/:id`、`/edit`、`/review` 时，这座宫殿的楼居中、略大、插小旗；今天还没评过也先放一块地基。
- 屋顶颜色取学科颜色，往暖灰调和一些，保持纸张暖光调性。

## 在哪里出现

只在全屏学习场景：随心、宫殿复习（`immersive`）与知识树、宫殿查看/编辑（`mindmap`）。普通页面不显示。

- **自己占高度**：作为外壳的一行放在主内容下面（桌面 80px、手机 56px），内容区相应变矮，**不覆盖任何内容**。
- **不接收输入**：`pointer-events: none`、`tabIndex=-1`、`aria-hidden`；键盘快捷键照常给学习用。
- **打字时淡出**：任何输入事件让地平线淡到 15%，停 1.5 秒后恢复。
- 随心全屏（`fixed inset-0`）会盖住地平线，这是有意的：全屏就是不要干扰。

## 事件 → 反馈

城市只读，不写学习或排期数据。实时事件先给即时反馈，随后快照以数据库为准校正。

| 来源 | 事件 | 地平线反馈 |
|---|---|---|
| 评分落库 | 应用事件 `review-unit:rated`（宫殿复习、整宫评分、随心评分接口成功后发出） | 对应楼下一扇窗按评分亮起并弹一下；忘记立待修牌。1.2 秒后拉快照 |
| 其他排期变化 | `review-state:changed` | 1.2 秒后拉快照 |
| 翻卡 | `memory-anki:mindmap-card-landed` | 当前楼下一扇未亮的窗闪一下，不留变化 |
| 做题 | 全局反馈 `quiz_result_correct/incorrect` | 答对楼旁长一棵树；答错飘过一朵灰云 |
| 新建节点 | 全局反馈 `node_create` | 当前楼加一个小阳台（每层最多两个） |
| 一轮结束 | 应用事件 `round-completed` | 楼从左到右依次弹一下，亮着的窗闪一遍 |

树、云、阳台只存在于本次页面，不入库；刷新后以快照为准。睡前复习不写复习账本，所以不改变窗户。

## 数据

`GET /dashboard/city-today` 只扫当天的评分操作（`review_unit_rating_operations`，排除撤销与被替换的），返回：

```json
{ "day": "2026-11-05", "palaces": [
  { "id": 7, "title": "…", "subject": {"id":1,"name":"…","color":"#d9634c"},
    "unit_count": 8, "rating_count": 3, "units": [{"id":"…","rating":4}] } ] }
```

请求时机：地平线首次出现、切回学习场景、评分或排期变化后 1.2 秒（合并连续评分）。不调用昂贵的 `/progression/overview`。

## 性能

- three/gsap 在 `public/city/vendor/` 本地化，只有首次进入学习场景才加载 iframe，首屏包体不变。
- 渲染上限 30fps、DPR 上限 1.5；离开学习场景时宿主发 `active=false`，iframe 停帧；标签页隐藏也停帧。
- `prefers-reduced-motion` 时所有动画直接跳到终态。

## 边界与不变量

- Three.js/WebGL 只允许在 `apps/web/public/city` 的 iframe 里；React 源码不得导入 `three`/`gsap`。`shared/fx` 的粒子/WebGL 禁令不变。由 `tools/check_architecture.py` 的 `check_city_horizon_boundary` 把关。
- postMessage 双向都校验同源与来源窗口。
- Service Worker 对 `/city/` 放行，避免 SPA 兜底把 iframe 换成应用外壳。
- 关闭：`localStorage` 设 `memory-anki:city-disabled=1` 后不再加载。e2e 夹具默认关闭；单元测试环境组件直接不渲染。

## 测试

- `src/modules/city/model/horizonModel.test.ts`：路由取当前宫殿、一卡一窗的点亮规则、窗数上限、金屋顶与待修牌、当前宫殿地基、按卡找宫殿。
- `apps/api/tests/test_dashboard_city_today.py`：只算今天、按首次评分排序、同一张卡取最近一次、撤销不计。
