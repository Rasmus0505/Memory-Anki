# 诊断记录隐私边界

左上角「录制」按钮背后的 `apps/web/src/shared/debug/session-recorder`，只用于回答“刚才点了什么、哪一步没成功”，不作为学习内容的备份或导出通道。

## 两类数据，不要混在一起

| 类别 | 示例 | 谁产生 | 是否原样保存 |
|---|---|---|---|
| 自动诊断元数据 | 页面类别、动作类别、HTTP 方法、状态码、成功/失败类别、数量 | recorder 自动采集 | 只保存白名单字段 |
| 用户主动说明 | 「你看到了什么」「给 AI 的说明」 | 用户手动输入 | 原样保存并随报告复制 |

用户手写内容属于显式授权输入。它不会被改写、截断或做“脱敏”，复制时放在 `## 用户补充` 之下，和自动事件分开。

## 自动采集允许的字段

- 时间。
- 固定事件类别：`session` / `route` / `click` / `menu` / `mindmap` / `doc` / `error` / `ai` / `step` / `view`。
- 固定动作类别，例如「点击控件」「单击节点」「翻卡」「导图编辑」「自动切到结算页」。
- 静态页面类别：`随心`、`知识`、`英语`、`创建`、`洞察`、`进度`、`设置`、`这个页面`。
- 学习区域类别 `quiz` / `freestyle` / `mindmap` / `review` / `other`，以及有界数量。
- HTTP 方法、有限状态码、固定失败类别、是否排队重试。
- 结构差异数量，例如「新增节点 3」「翻开 1 项，收起 1 项」。

## 自动采集禁止的字段

题目、选项与答案文字；脑图节点标题、正文、摘录；DOM `textContent` / `innerText`；自由的 `aria-label`、`title`、`placeholder`（只允许读取它们判断“是不是敏感输入框”，读取值不得写入记录）；文档旧文本与新文本；服务端原始错误 `message`；完整 URL、query、hash；动态业务 ID（卡片、回合、操作、题目、节点）；请求体与响应体；token、密钥、`Authorization` 凭证。

实现方式是按结构化白名单**在入口处直接构造安全事件**，而不是先收集全文再用正则“脱敏”。正则脱敏只能当兜底，不能当选边界。

## 三个收口位置

1. **采集入口**：`sessionRecorderCapture.ts`（点击）、`sessionRecorderBrief.ts`（焦点与请求描述）、`sessionRecorderDocDiff.ts`（文档差异）、各业务组件只允许写 `data-recorder-context` / `data-recorder-count`。
2. **store 归一化**：`sessionRecorderStore.ts` 的 `normalizeEvent()` 把未知动作折叠成固定类别，未知详情直接丢弃。
3. **报告出口**：`sessionRecorderFormat.ts` 的 `safeRouteLabel()` / `safeReportAction()` / `safeReportDetail()` 对路径、动作、详情再过一遍白名单。这样即使旧历史或未来旁路调用方带入自由文本，剪贴板和报告也不会原样输出。

出口清单：滚动事件缓存、当前显式录制、历史 `localStorage`、实时简报、剪贴板复制。它们必须共用同一套最终边界。

## 存储版本与旧历史

- `memory-anki.session-recorder.history.v2`：当前历史，结构同上。
- `memory-anki.session-recorder.history.v1`：旧历史，**只删除，不迁移**。旧版本可能已写入题目、答案、节点标题和原始错误，无法可靠判定哪些片段安全。
- `memory-anki.session-recorder.privacy-migration.v2`：一次性迁移标记。

迁移在 recorder 模块同步初始化阶段执行（`history: loadHistory()` 会立即调用），不依赖构建版本号。它只删除自己登记过的 key，不调用 `localStorage.clear()`，并在 `getItem` / `removeItem` / `setItem` 抛异常时静默继续，保证应用仍能启动。标记写入后重复刷新不会再次清除新版历史。

三个 key 都登记在 `apps/web/src/shared/persistence/storageRegistry.ts`。

## appLogs 的边界

`shared/logs/model/appLogs` 是相邻但独立的日志系统，它仍可能保存原始错误文本。本轮只做了一件事：**阻断它把内容自动流入 recorder**——`app_error` 只贡献「应用错误」这一固定类别，`stage` 也不进入自动记录。

appLogs 自身的历史清理与保留策略不在本文范围；需要变更时应单独设计，不要顺手改 recorder 的出口。

## 无法追溯的部分

已经复制到剪贴板、粘贴进外部文档或发给 AI 的旧记录，本轮无法追溯删除。本次改动只保证从现在起自动采集不再产生学习内容。

## 新增诊断字段的流程

1. 先问：这个值在离线、跨设备、被转发后是否仍然安全？
2. 能换成固定类别或有界数量的，换成类别/数量。
3. 确实必须新增字符串时，同时改三处：入口归一化、`sessionRecorderFormat` 白名单、`tools/check_architecture.py` 的守卫。
4. 在 `sessionRecorderStore.test.ts` 加一条“这个值不会出现在报告/历史/剪贴板里”的反向断言。

## 静态守卫

`tools/check_architecture.py` 的 `check_session_recorder_boundary()` 会阻止：

- 任何前端文件重新出现 `data-recorder-title` / `data-recorder-excerpt` / `data-recorder-place`。
- recorder 生产代码读取 `textContent`、`innerText` 或 `appLogs` 的 `errorMessage`。
- recorder 生产代码调用 `localStorage.clear()`。
- 历史 key 退回 v1、迁移标记丢失。
- 报告格式化层丢掉白名单函数。
- 本文件或 README 中的说明被删除。
