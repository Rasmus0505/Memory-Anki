# 模块：city

## 负责
学习场景底部的城市地平线：今天这座岛，一宫一楼、一卡一窗。

## 公共入口
`public.ts` — 唯一的跨模块导入路径。

## 规则
- Three.js / GSAP 只在 `public/city/horizon.html` 的隔离 iframe 里运行，React 包不导入。
- 只读：只消费学习事件和 `GET /dashboard/city-today`，不写任何学习或排期数据。
- 地平线自己占布局高度、不接收指针，不遮挡内容、不抢键盘。

详见 `docs/architecture/city.md`。
