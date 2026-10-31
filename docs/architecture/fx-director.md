# FX Director（反馈运行时）

`apps/web/src/shared/fx` 是唯一的反馈入口。业务代码说**发生了什么**，recipe 决定**怎么反馈**。

当前只有三类反馈通道：**声音**、**震动（haptics）**、**CSS 果冻动效（jelly）**，外加 DOM 小动效（bump / flash / charge / 微反馈气泡）。
粒子系统、WebGL/Canvas 特效、FX Lab 页面均已移除，不要再引入。

```text
caller ──cue('grade.commit', payload, { owner })──▶ director ──▶ recipe.play(payload, stage)
                                                     │              ├─ sound / haptics (shared/feedback)
                                                     │              └─ jelly / DOM flourish (CSS class)
                                                     └─ policy gate (settings scene + prefers-reduced-motion)
```

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 公开出口：`cue`、owner 控制（`openPlayback`、`retireOwner`、`skipOwner`、`resumeOwner`）、`resolveFxGate`、锚点、DOM 小动效、`jellyOn`、`useFxOwner`。 |
| `core/director.ts` | `defineCue(name, recipe)` / `cue(name, payload, { owner })`。`FxCueMap` 由 recipe 文件 declaration merge，payload 按事件有类型。 |
| `core/policy.ts` | `resolveFxGate(scene)`：唯一把设置与 `prefers-reduced-motion` 翻译成通道开关的地方。场景：`review`、`milestone`、`completion`、`ambient`（`ambient` 只看全局开关，且不发声、不震动）。 |
| `core/owner.ts` | owner 作用域播放。延迟步骤挂在 owner 上；`retireOwner` 取消全部待执行步骤。`useFxOwner` 把 owner 绑定到组件身份。 |
| `core/anchors.ts` | 具名锚点（`data-fx-anchor`），供需要定位的反馈使用。不使用测试 id。 |
| `core/domFlourish.ts` | `bumpElement` / `chargeElement` / `flashElement`。 |
| `core/jelly.ts` | `jellyOn(el, 'pop' \| 'press' \| 'wobble')`：挂上 CSS 类，动画样式在 `apps/web/src/styles/jelly.css`，且只在 `prefers-reduced-motion: no-preference` 下生效。 |
| `core/microBubble.ts` | `showMicroBubble(anchor, { tone, parts, zone, placement })`：答题耗时、评分间隔、单元清盘等瞬态胶囊。挂 body（或原生全屏宿主）的固定顶层，`z-index: 10000` 高于 dialog 的 240/241/255；`pointer-events: none`，同 zone 新气泡让旧气泡 180ms 加速淡出。文案由纯函数生成并有单测。 |
| `recipes/learning.ts` | 学习场景 cue：评分、翻卡落定、单元完成、撤销、移除、重试、进度四分之一、答对/答错、区域清空、翻页、轮次完成。 |
| `recipes/map.ts` | 思维导图场景 cue（如 `audio.pops` 分层弹跳）。 |

## 规则

1. 业务代码只从 `@/shared/fx` 导入。`check_fx_director_boundary` 拒绝 `@/shared/fx/{core,recipes}` 的深层导入，以及 `canvas-confetti`（已禁用）。
2. 实体相关的 cue 传入由实体身份派生的 `owner`（如 `card:${progressKey}`、`round:${roundKey}`）。离开实体即 `retireOwner`。
3. 调用方不读取反馈设置；由 recipe 的 `scene` 决定开关。需要升级的 recipe 通过 `stage.gateOf(scene)` 读取其他场景的门。
4. `shared/fx` 不得导入 `modules/`、`pages/`、`widgets/`、`app/`，也不得导入 `@/shared/theme`（`check_visual_layer_purity`、`check_theme_pack_registry`）。
5. 减弱动效（`prefers-reduced-motion: reduce`）时：`resolveFxGate` 关闭动效基础位，果冻动效不生效，声音与震动按各自设置降级。
6. 带延迟的步骤必须挂在 `FxPlayback` owner 上，不得裸用 `setTimeout`。
7. 瞬态微反馈气泡只从 `@/shared/fx` 调用 `showMicroBubble`。不要把它渲染进卡片、评分 dock 或 dialog 内部：祖先的 `transform`、`overflow: hidden` 和 z-index 会把气泡裁掉或压到题目下面。气泡必须保持 `pointer-events: none`，并在 `prefers-reduced-motion: reduce` 下退化为原地淡入淡出。

## 新增一个反馈

在 recipe 文件中声明 payload（`FxCueMap` 扩展），再用 `defineCue(name, { scene, play })` 注册；业务在所属 owner 模块里调用 `cue(name, payload, { owner })`。
新效果只能用声音、震动、jelly 类或 DOM 小动效表达。
