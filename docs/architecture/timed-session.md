# 前台有效计时器边界

计时器属于 `modules/session`。页面只提供目标身份和场景信息，计时器注册表负责生命周期、前台活动区间和最终写入。浮层是控制面的投影，不拥有会话。

## 单一注册表

注册表按稳定 `sessionKey` 建立一条会话：

| 目标 | `sessionKey` |
| --- | --- |
| 宫殿 | `palace:{id}` |
| 英语课程 | `english:{courseId}` |
| 英语阅读材料 | `english-reading:{materialId}` |
| 随心模式 | `freestyle` |

首个页面固定标题、分类和目标；后续页面只追加 `sceneSegments`。切换到另一个 key 时先结算当前会话，再附着新目标。关闭浮层只移除控制面板，不改变会话状态。

## 状态与时钟

状态只有 `idle`、`running`、`paused`、`completed`。`running` 只在**控制器**页面可见且窗口有效时拥有一个活动区间；每次暂停先结算区间，恢复再开启新区间。`visibilitychange`（hidden）和 `blur` 触发系统暂停，回到前台只恢复系统暂停；手动暂停必须由用户恢复。

PWA 与电脑端同时打开时，live room 选出一个 `controller_client_id`。跟随端抑制本地区间（`liveClockOwnership`），只渲染投影秒数，避免双倍计时。详见 [live-study-presence.md](./live-study-presence.md)。

墙钟只用于界面刷新和区间边界，不用于恢复时追赶离线时间。该规则就是 **foreground-only** 计时：快照保存已结算的精确秒数与暂停原因，重新加载不会自动补算或自动继续；旧快照仅按兼容规则转换为暂停快照。

## 写入契约

Study Session HTTP payload 使用以下版本字段：

| 字段 | 作用 |
| --- | --- |
| `session_key` | 跨页面合并同一学习目标 |
| `client_revision` | 客户端单调版本，低版本或相同版本写入被忽略 |
| `operation_id` | 逻辑操作幂等键，重复请求返回已接受结果 |

计时运行期间只写本地快照，不发送 autosave 记录。完成、离页或应用关闭时，注册表生成一条终态记录并通过 SessionPort 写入；持久化链和后端版本防线共同保证同一 key 只有一条最终记录。非手工时长必须不超过开始到结束的服务器墙钟间隔。

`duration_edited=true` 只由历史记录编辑器显式设置。实时计时器永远提交观测到的前台秒数，不能通过该标记绕过墙钟校验。正式复习仍由复习提交接口生成记录，不产生普通计时记录。

## 依赖边界

页面和 widgets 只能从 `modules/session/public.ts` 使用会话能力。注册表和时间累计保持框架无关；浏览器可见性、失焦、卸载和本地快照属于运行时适配层。SessionPort 的服务端实现负责 revision/operation 幂等、终态保护和历史手工编辑例外。
