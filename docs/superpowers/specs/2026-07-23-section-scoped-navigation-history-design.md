# 分区作用域导航历史（前进/后退）

**日期：** 2026-07-23  
**状态：** 已批准（方案 A）  
**范围：** 仅左上角 GlobalBackButton；五个主导航分区

## 问题

左上角的后退/前进控件镜像的是**全局**浏览器历史栈。切换主标签页（随心 / 知识 / 英语 / 创建 / 洞察）与分区内下钻相互交织，因此：

1. 用户在知识内打开一个深层页面（例如知识树编辑器）。
2. 用户切换到随心，再切回知识（通过 `sectionLastUrls` 恢复深层页面）。
3. 按下后退会跳到随心，而不是在知识**内部**离开编辑器。
4. 深层页面感觉卡住了；“按分区保存的进度”与全局撤销相冲突。

## 目标

- 后退/前进仅作用于**分区内场景历史**。
- 当活动分区没有更早的条目时 → **禁用**后退（没有跨分区回退）。
- 保留现有的标签页记忆（`sectionLastUrls` / 二次点击返回分区根）。

## 非目标

- 使系统/浏览器/Android 硬件返回键与分区栈对齐（未来）。
- 将分区栈持久化到 `localStorage` 或跨设备。
- 更改 `pageHistoryStore` 中的滚动/UI 快照。

## 模型

- 每个 `NavSectionKey` 一个栈：`freestyle | palaces | english | knowledge | review`。
- 分区解析使用**与** `navSections.matches` **相同的路径规则**（而非 `pageHistoryRoute` 的分区，后者在资料库 vs 创建 vs 洞察上有所不同）。
- 条目：`{ key, fullPath }`（pathname + search + hash）。
- 栈操作复用以浏览器方式进行的 push/replace/pop 截断（`navigationHistory.ts`）。
- 生命周期：**仅内存，仅当前标签页**。刷新 → 当前 URL 的单条目栈。

## 记录规则

| 事件 | 行为 |
|-------|----------|
| 分区内 PUSH/REPLACE | 只更新该分区的栈。 |
| 跨分区导航（切换标签页） | **不要**将来源路径 push 到目标栈。切换 `activeSection`。进入时：如果当前 `fullPath` 已存在于该分区的栈中，将 `index` 指向那里并刷新 `location.key`；否则将该分区重置为当前 URL 处的**单条目**栈。 |
| 分区作用域的后退/前进 | `navigate(targetFullPath)` + 待处理标记，使位置更新调整 `index` 且**不** push 重复项。 |

在五个分区之外（例如个人资料）：两个按钮都禁用。

## 用户体验场景

- 深层页面 → 其他标签页 → 返回深层 → 后退留在分区内并逐级退出。
- 栈中只有根 → 后退禁用；再次点击标签页仍返回分区根。
- 单条目的深层落地（刷新 / 启动恢复 / 直接打开 `/knowledge`）会植入一个合成的分区根锚点，使**后退**仍能离开到分区主页（例如 知识树编辑器 → 学科书架 `/palaces`），而不会跨标签页。
- 再次点击活动标签页返回根是正常的分区内 PUSH（截断前进）。

## 实现触点

- `shared/page-history/navigationSection.ts` — 路径 → 分区（镜像 nav 匹配器）。
- `shared/page-history/sectionNavigationHistory.ts` — 多栈纯函数。
- `shared/page-history/useNavigationHistory.ts` — 接入栈；后退/前进使用路径导航。
- `GlobalBackButton` — 标题/提示；仍然消费该 hook。
- 纯函数与 hook 场景的单元测试（知识深层 → 随心 → 知识 → 后退仍留在知识）。

## 成功标准

- 复现路径能离开知识深层页面且不会落到随心。
- 分区内 A→B→C 的后退/前进表现得像单个浏览器栈。
- 相关前端单元测试通过。
