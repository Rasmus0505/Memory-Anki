# 测验前端边界


测验题目契约、API 包装器、运行时状态、可复用的作答交互 UI、作答编排和结果反馈都属于 `modules/quiz`。这些能力由宫殿测验、随心复习和复习流程共享，不得位于面向页面的路由内部。

```text
pages/palace-quiz -> modules/quiz/public.ts
modules/practice/ui/freestyle -> modules/quiz/public.ts
modules/practice/ui/review -> modules/quiz/public.ts
```

宫殿记忆查找对话框组合了宫殿数据、复习反馈和脑图编辑器，因此它属于 `widgets/palace-memory-lookup`。宫殿测验和随心都消费该 widget，而不会互相导入。当调用方传入当前题目绑定的节点 uid（`focusNodeUid` / `focusNodeUids`，来自 `collectMemoryLookupFocusNodeUids`）时，对话框会保留完整的宫殿 `editor_doc`，并通过 `focusRequestNodeUid`（`resolveMemoryLookupFocusNodeUid`）在视觉上将最深的绑定节点居中。默认的宫殿根绑定绝不能压过更深的绑定卡片。它不得将树重新定根或裁剪到绑定节点。打开查找必须直接落到那张卡片上：测验宿主在点击之前读取当前题目的绑定（`useQuestionLookupFocus`，由该 widget 导出），对话框会保持地图直到它们解析完成，然后传入 `initialFocusNodeUid`，让首个镜头居中该卡片，而不是先适配整个宫殿再飞越过去。居中的卡片带有节点高亮。宿主每次打开都重新设置对话框的 key，因此另一道题的查找绝不会先画出前一个宫殿。查找没有视图/翻转/编辑切换：它以普通宫殿编辑器打开在同一份完整宫殿文档上，按编辑器默认深度折叠分支（绑定分支保持展开），显示与宫殿编辑器相同的每节点题目数徽章，并通过宫殿编辑器自动保存（`palace_edit_autosave` 加上 `expected_editor_fingerprint`）；关闭时会冲刷待保存的文档并对账复习单元。它不得保存被裁剪的子树。节点绑定题目徽章使用 `widgets/node-bound-quiz`。随心工具栏的“做题”使用 `widgets/freestyle-scope-quiz`：相同的作答外壳，题目列表来自轮次已排期的复习单元加上每个单元的根→锚点路径，或者当 `overlay_question_range` 为 `whole_palace` 时来自整个宫殿。两个叠加层都把“复制导图”放在“查看宫殿”旁边：它读取当前题目所在宫殿的完整脑图，并复制纯文本大纲——每张卡片一个 `- ` 项目符号，每层两个空格，卡片备注作为缩进的“备注”行——以便学习者粘贴到 AI 聊天中作为作答背景。它不得复制 JSON 传输文件、节点 id 或样式。旁边，“复制题目”会把该窗口中加载的每道题（`buildQuizQuestionsCopyText` / `useCopyQuizQuestionsText`）复制为纯文本：带编号的题干、选项、该题型对应的答案（选择 / 判断 / 填空 / 配对 / 排序 / 归类 / 简答，包括错误点和多空或多选答案），然后是解析。范围是整个窗口——不只是屏幕上的那道题，也不只是可见的题号页——并且不得复制宫殿上下文、作答统计、标记或 JSON。持久的叠加层成员关系与已作答草稿位于轮次计划的 `overlay_quiz` 上，并在 PWA 重载后保留。SPA 的 `quizSessionProgress` 镜像在节点绑定徽章、叠加层和宫殿测验练习之间共享。刷新会恢复它，不会清除它。工具栏的“做题”在重载后从 `overlay_quiz` 重新播种任何缺失的答案。「再来一轮」是对共享“已做”的显式清除。当一个宫殿在轮次中的复习单元全部评分后，UI 会在丢弃该宫殿的叠加层“已做”之前询问。三个界面都显示“标记 / 取消标记”。标记会写入 `marked`，并且不排期复习也不自动前进。索引轨道上已标记的题号使用玫瑰色填充。它不得切换 `training_mode` 或打开 `QuizLauncher`。新的跨场景测验原语应加入 Quiz 实体；新的多特性视觉组合应加入 widget 或页面。
<!-- invariant: quiz-lookup-centers-bound-node -->
<!-- invariant: quiz-lookup-no-reroot-clip -->

选择题主动回忆改写（选择 / 主观）位于 Quiz 实体中：`quizAnswerMode`、`mcqSubjectiveRewrite`、`QuizQuestionStem`、`QuizQuestionInteraction`，以及客户端偏好 `quiz_answer_mode`。切换到“主观”会重写题干，使其不依赖选项，并保持同等或更高的回忆难度（而不是更短的识别提示）。在任一呈现被作答后，“选择 / 主观”切换仍然可用。主观提交不会关闭选择题尝试（`isQuizChoiceAttemptClosed` 是“已选中一个选项”，而不是共享的 `resolved` 标志），选择题尝试也不会关闭主观草稿。转换后的选择题提交之后，实体会列出原始选项但不标出正确选项，并把参考答案写为解析的第一行。Enter 提交简答题尝试；一旦该答案在做题叠加层中可见，同一个 Enter 绑定就前进到下一题，而不是再次提交。当题目或模式变化时，交互表面会恢复键盘焦点，因此宿主不会让提交快捷键卡在“下一题”上。随心卡片、节点绑定测验对话框和宫殿测验练习都消费该原语；它们不得重新实现切换、题干重写、简答呈现或提交快捷键。
<!-- invariant: quiz-answer-mode-ownership -->
<!-- invariant: quiz-subjective-stem-rewrite -->
<!-- invariant: quiz-converted-analysis-first-line -->

做题叠加层（`widgets/freestyle-scope-quiz`、`widgets/node-bound-quiz`）通过 `QuizQuestionIndexPager` 对顶部题号轨道分页。一页是一行实测宽度：胶囊尺寸保持固定（`size-7`），由 `quizIndexPageCapacity` 决定能容纳多少；未测量时的回退值是 20。行标签为 `第 {page}/{pages} 页 · 第 {current}/{count} 题`（没有起止范围）。当该分页器可见时，宿主会把“已答”和宫殿上下文保留在对话框描述中，且不得在那里重复当前题目计数器。宿主不得内联渲染完整的圆形按钮网格。轨道固定在滚动作答主体之外（`pinned`、`data-quiz-index-rail`），并忽略子胶囊宽度抖动，因此揭示答案不会重新打乱可见题号。叠加层面板使用 `QUIZ_ANSWERING_DIALOG_CLASS`，使浮动窗口保持稳定高度，答案在内部滚动，而不是让面板重新居中。
<!-- invariant: quiz-index-pager-ownership -->

节点绑定“关联题目”窗口的「打乱题库」顺序位于 `quizShuffleOrder` 中，并作为 `quiz_shuffle_orders` 客户端偏好持久化，而不仅仅存在浏览器存储中。该窗口每次打开都会根据打开者的 id 重建，因此顺序必须在其中存活；以 `palace:node` 为键（题目集作为第二键，localStorage 仅在偏好加载前作为镜像）正是避免一次打乱在另一个界面或另一台设备上又显得全新的关键。打开窗口从不打乱；只有按钮会，而且它只在未作答题目各自的槽位之间移动这些题目。
<!-- invariant: quiz-shared-shuffle-order -->

选择题选项的显示顺序也归 Quiz 实体的共享作答交互所有：`QuizQuestionInteraction` 继续用 option id 判分和提交，只在当前交互实例的临时展示状态中保存首次原序、当前显示顺序和是否已打乱，不写入答题进度。手动“打乱选项”只影响当前题，重复打乱不覆盖首次原序；“恢复选项”回到首次原序并重新显示原选项 id。打乱后题号前缀的位置保留固定宽度，选项文本不得因为前缀消失而横向跳动。自动规则由 `quiz_option_shuffle` 客户端偏好控制，默认开启且阈值为 5 秒；作答耗时严格小于阈值时只登记“下次见到这题时打乱”，绝不当场重排正在阅读的答案与解析，等到该题下一次被显示时才在首帧打乱。配置入口只在随心“做题配置”中提供，但偏好跨做题场景和设备共享。选项重排不得修改题目 payload、正确答案或选择 id 集合。
<!-- invariant: quiz-shared-option-shuffle -->

做题窗口的右上角操作条拥有固定数量的槽位：一个控件在当前题或当前状态下不适用时保持可见但禁用，不得从 DOM 中移除。`打乱选项 / 恢复选项` 共用同一个槽位，`打乱题库` 在题池不足两题时禁用。原因是一次打乱把“恢复选项”加进操作条会把整行挤成两行、把题目正文整体下推，观感上像整个窗口重排了一次。
<!-- invariant: quiz-stable-action-bar -->

做题快捷键位于 Quiz 实体中：`quizShortcuts`、`QuizShortcutSettingsSection` 和 `useQuizAnsweringShortcuts`，作为 `quiz_shortcuts` 客户端偏好持久化。随心“做题”在左上角“配置”面板中显示该区域。节点绑定“关联题目”从其左上角“快捷键”控件打开同一区域。两个对话框共享同一张映射。标记默认是 ArrowUp，每次按键切换一次；按键重复不得再次切换。题目导航、选项移动、数字与字母选择以及 Enter 提交保持可配置。ArrowUp 不同时作为上一选项的默认键。任一对话框打开时，ArrowUp 和 ArrowDown 不得翻动其下的随心信息流。宿主不得为这些操作保留第二个 keydown 监听器。删除默认是 Backspace，列在同一设置区域中，并打开现有的删除确认；它不会从已启用的文本字段中触发。答案揭示后，提交绑定在还有下一题时前进；按住时不重复。确认对话框（`ConfirmDialog`、`appConfirm`）接受 Enter 以确认。当 `[data-confirm-dialog="open"]` 对话框打开时，测验快捷键让路，以免 Enter 被抢走。
<!-- invariant: quiz-shortcut-arrowup-marks -->

`QuizQuestionAnswerSurface` 统一题干、字号与答题交互的呈现；入口仍各自拥有题目范围、轮次身份和保存。`Ctrl+Z` 默认清除当前题的作答与草稿，不清累计统计；输入框、快捷键录制和确认窗口优先处理自己的按键。重答后旧 AI 点评请求不能重新写回已清除的状态。
<!-- invariant: quiz-shared-answer-surface -->

作答对话框字号缩放位于 Quiz 实体中：`quizFontScale`、`useQuizDialogFontScale`、`QuizFontScaleBody`、`QuizFontScaleHint`，以及 `quiz_font_scale` 客户端偏好。节点绑定对话框和随心“做题”对话框共享同一个百分比（70–180，步长 10，默认 100）。Ctrl+滚轮向上放大，Ctrl+0 恢复 100%；该 hook 拥有这一手势（`passive: false`，因此浏览器不会缩放页面），并短暂显示百分比。宿主只把 `QuizFontScaleBody` 应用于题目正文（题干、选项、输入、解析）。头部、题号轨道、徽章和页脚保持默认大小。宿主不得附加自己的滚轮监听器或存储第二份缩放。
<!-- invariant: quiz-shared-dialog-font-scale -->

## 作答耗时反馈

`showAnswerDurationBubble`（`modules/quiz/domain/quiz-entity/ui/answerDurationBubble.ts`）会在被点击的选项或提交按钮旁边向 `document.body` 追加一个自动消失的耗时胶囊。它故意位于题目组件之外：前进到下一题时它不得被卸载。它会在约 1.5 秒后自行淡出，并尊重 `prefers-reduced-motion`。随心复习评分条（普通条和睡前条）复用同一辅助函数，因此一次评分点击会显示该复习单元上花费的时间，而不必绑定到卡片的生命周期。

作答结果音效和触感属于给出答案的那次点击，而不是尝试写入。当宿主传入 `resultFeedbackMode: 'immediate'` 时，`useQuizAttemptOrchestration` 会在提交尝试之前播放它们；随心信息流从 `useFreestyleQuizFlow.updateQuestionState` 播报，因为被动 effect 只会在整个信息流重新渲染后运行，快速翻页会让提示慢一拍。只有尝试记录、权威题目刷新和自动标记 toast 可以等待服务器，而一个没有经过该漏斗却到达信息流的解答仍会由进度 effect 播报一次。`FreestyleQuizCardView` 的 `answer.correct` / `answer.wrong` 提示以该卡片上的实时解答为键，而不是 `active`：一旦翻页开始，信息流的视觉索引就会移动，因此以它为门控会吞掉在仍在稳定中的卡片上点击的答案提示。

两个作答叠加层使用 `QUIZ_ANSWERING_DIALOG_CLASS`（宽 58rem，高 86vh）。待换题批量条位于 `DialogHeader` 下方自己的整行上；它不得放入 `DialogHeader` 的右侧操作簇，否则会与标题及现有的复制/查看操作重叠。

## 在做题窗口中就地编辑题目

糟糕的题干或错误的答案键通常是在作答时被发现的，而不是在宫殿测验 → 题库管理中，因此随心“做题”叠加层在自己的窗口中就地编辑当前题目：“编辑”按钮位于题目元信息行（“移除本宫殿 / 删除”旁边），把题干 + 答案交互换成 `QuizQuestionEditForm`，而不关闭对话框或离开轮次。
<!-- invariant: quiz-inline-edit-in-window -->

该表单、其模型和 `canManuallyEditQuestion` 位于 Quiz 实体中（`quizQuestionForm`、`QuizQuestionEditForm`），并与宫殿测验管理卡片共享；叠加层不得长出自己的一份副本。模型把答案保存为 `correct_option_ids`，因此打开一道有多个正确选项的选择题并保存错别字修正时，不会悄悄丢掉额外的答案；选择一个 id 保存为 `correct_option_id`，两个或更多保存为 `correct_option_ids`。只有选择题和简答题可编辑——其他题型保持只读呈现。

保存会经过 `updatePalaceQuizQuestionApi`，然后清除该题目的已作答状态（`resetLocalAnswer`，随轮次的 `overlay_quiz` 持久化），否则旧的“已答对”徽章会描述已不存在的文本。编辑器打开时它独占键盘（`useQuizAnsweringShortcuts` 被禁用），页脚的“上一题 / 下一题”和题号轨道被锁定，因此草稿不会被误触按键或点击丢弃；“保存题目 / 取消编辑”是唯一的离开方式。

## 应用测验启动器

全局测验启动器由 `AppProviders` 挂载，协调宫殿元数据、导航和打开宫殿测验页；它不再提供 AI 生成或后台生成任务（相关入口已移除）。它属于 `widgets/quiz-launcher`，题目交互仍留在 `modules/quiz`。宫殿查看、宫殿编辑和复习流程消费该 widget 上下文，而不导入测验内部实现。

复习反馈奖励状态和可复用的反馈编排位于 `modules/memory/domain/review-entity`，因为宫殿练习、复习流程和查找 widget 共享它们。路由代码不得在页面下重建这些模型。
