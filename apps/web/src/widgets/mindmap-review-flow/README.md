# 脑图翻卡流程组件

用于复习会话和宫殿练习宿主的跨功能组合。

- `FlipCardMindMapPanel` 是唯一的翻卡脑图界面。宫殿学习和正式复习都通过组件索引消费它。
- 该面板负责翻卡导航、键盘/触摸行为、全屏/清除 UI 控件、视图持久化，以及“点击卡片不重新居中”策略。宿主可以为 Enter 翻卡跟随传入 `revealFollowNodeIds`；该最小平移不适用于点击。
- 题目卡片（节点数据上的 `memoryAnkiQuestionCard`）在其父节点变为 `revealed` 时自动翻出正文文本（共享的 `entities/review` 级联）；通过编辑器上下文菜单设置/清除。
- `MindMapReviewFlow` 将共享面板与复习完成及可选的评分证据组合在一起。宫殿学习保留自己的进度持久化，且不提供评分回调。
- 复习领域转换和可复用复习 UI 保留在 `features/review` 或 `entities/review` 中。
- 页面和路由宿主不得直接导入组件控制器的内部实现。
