# 0006 右键删除宫殿后整个页面点不动——两份 Radix 弹层各自记着 body 的 pointer-events

**状态**：根因已定位、已修复、有守护测试。
**首次记录**：2026-11-07
**影响**：从右键菜单执行任何会打开确认框/输入框的操作（删除宫殿、删除章节、重命名……）后，
整个页面失去指针交互：左侧宫殿目录点不动，右侧脑图视图拖不动；
已打开、带 `pointer-events: auto` 的控件（如部分 HUD 按钮）仍能点击，所以现场看起来像"只有一半坏了"。
必须刷新页面才能恢复。

---

## 1. 用户看到的现象（人话）

在随心复习页左侧目录里右键一座宫殿 → 删除宫殿 → 确认。
页面会卡一会儿，然后：

- 左侧宫殿目录滚得到，但点什么都没反应；
- 右侧脑图还能点节点，却拖不动视图；
- 刷新之后一切正常。

## 2. 实际发生的机制

Radix 的弹层（右键菜单、确认框、下拉菜单、Popover…）在打开时会做一件事：

```js
// @radix-ui/react-dismissable-layer
if (layersWithOutsidePointerEventsDisabled.size === 0) {
  originalBodyPointerEvents = document.body.style.pointerEvents
  document.body.style.pointerEvents = 'none'   // 弹层以外全部不可点
}
// 卸载时把 originalBodyPointerEvents 写回去
```

`originalBodyPointerEvents` 是**模块级变量**，所以"记录原值 / 恢复原值"只有在
**同一份模块**里才是配对的引用计数。

问题出在依赖树：Radix 各组件包把 `@radix-ui/react-dismissable-layer`
**钉死成不同版本**，npm 因此装了两份：

| 包 | 钉住的 dismissable-layer |
|---|---|
| `@radix-ui/react-context-menu`（右键菜单） | `1.2.1`（嵌套在它自己的 node_modules 里） |
| `@radix-ui/react-dialog`（确认框） | `1.1.12`（提升到顶层） |
| `@radix-ui/react-dropdown-menu` | `1.1.12`（同一份） |
| `@radix-ui/react-popover` / `react-select` | `1.1.14`（各自嵌套） |

于是删除宫殿的真实时序是：

```
右键菜单（copies A, 1.2.1）打开
  A: original = ''      body = none
点「删除宫殿」→ 确认框（copy B, 1.1.12）叠上来
  B: original = 'none'  body = none     ← B 看到的是 A 已经改过的值
菜单播完退场动画卸载
  A: body = original '' （此时确认框还开着，背景短暂可点）
确认 → 弹窗卸载
  B: body = original 'none'              ← 写回 none，且再也没有人解锁
```

`body { pointer-events: none }` 会被所有没有显式 `pointer-events` 的后代继承，
所以整页点不动。React Flow 的 `.react-flow__pane` / `.react-flow__node`
在自己样式里写了 `pointer-events: all`，因此脑图节点仍能点；
而拖动画布要走应用自己的手势层和 `elementFromPoint`，拿不到命中结果，就表现为"能点、不能拖"。

"卡了一会"是删除请求本身：后端级联删除宫殿、章节绑定和练习记录，
前端随后重拉目录；这段等待与上面的锁无关，但两件事挨在一起，看起来像同一个卡死。

## 3. 证据

在 dev 服务器（5173）用一座一次性宫殿复现，确认框点「删除宫殿」后立刻读取：

```
document.body.style.pointerEvents  ->  "none"
document.querySelectorAll('[role="dialog"]').length -> 0
document.querySelectorAll('[role="menu"]').length   -> 0
```

弹窗已经全部卸载，body 仍被锁死。用 `elementFromPoint` 探测左侧目录行的位置返回 `null`，
与"点不动"一致。修复后同一流程返回 `""`，`elementFromPoint` 命中目录行的文字节点。

## 4. 修复

`apps/web/package.json` 增加 `overrides`，把所有 Radix 包统一到同一份
`@radix-ui/react-dismissable-layer@1.2.1`：

```json
"overrides": {
  "@radix-ui/react-dismissable-layer": "1.2.1"
}
```

一份模块 = 一个引用计数：菜单开着时弹窗挂载不会二次记录原值，菜单卸载时也不会提前解锁，
最后一个弹层关闭才恢复 `''`。`apps/web/package-lock.json` 随之去重。

守护测试：`src/shared/components/ui/radixOverlayDedupe.test.ts`
从右键菜单、Dialog、下拉菜单、Popover、Select 五个入口分别解析 dismissable-layer，
断言解析到同一个文件。任何人升级 Radix 导致 npm 重新装出第二份，测试立刻失败。

## 5. 验证

- 复现前：删除后 `body.style.pointerEvents === 'none'`，目录不可命中。
- 修复后：dev（5173）与 8012 上实际构建产物各跑一遍删除流程，
  `body.style.pointerEvents === ''`、无残留弹层、目录行可被 `elementFromPoint` 命中。
- `npm test`：402 个文件 / 2750 个用例全绿；`npm run lint`、`npm run build`、
  `python tools/check_architecture.py` 均通过。

## 6. 未一并处理的部分

- `@radix-ui/react-focus-scope` 等其他 Radix 基础包仍有重复副本，会产生各自的焦点栈，
  但目前没有观察到可复现的用户症状，本次不动。
- 删除宫殿请求本身的耗时（后端级联 + 目录重拉）没有优化；这是"卡一会"的另一半，
  与本次交互锁死无关。
