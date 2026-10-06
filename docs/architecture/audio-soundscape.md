# 音效与声景（Audio Soundscape）

> 本文说明 Memory Anki 的全部程序化声音：合成音数据源、主题音色、音频上下文生命周期、
> 静音分区与音量优先级。所有声音均为 **Web Audio 实时合成**，项目没有音频素材文件依赖。

## 一句话模型

「反馈事件（语义） → `ToneSpec[]`（数据源） → 主题包音色着色（`colorTone`） → 单一 `AudioContext` 播放」，
再叠加两条独立通道：**界面音（`uiSounds`）** 与 **音景氛围（ambient）**。

## 分层与所有权

| 层 | 位置 | 职责 |
|---|---|---|
| 事件语义 | `shared/feedback/feedbackEvents.ts` | `MindMapFeedbackEvent` 联合类型，唯一事件名来源 |
| 音色数据源 | `shared/feedback/mindmap-audio/toneProfiles.ts` | 每个事件对应一组 `ToneSpec`（「听声辨事」唯一数据源） |
| 播放器 | `shared/feedback/mindmap-audio/webAudioFeedback.ts` | `AudioContext` 单例、振荡器编排、音量钳制 |
| 主题着色 | `shared/feedback/mindmap-audio/packTimbre.ts` | 按主题包 `PackTimbre` 调制音高/包络/波形 |
| 事件桥接 | `shared/feedback/mindmap-audio/useMindMapFeedback.ts` | 把编辑器/画布事件接到播放器 |
| 界面音 | `shared/feedback/uiSounds.ts` + `uiSoundSynth.ts` | 全局委托监听，按钮/开关/标签页的通用音 |
| 反馈导演 | `shared/fx`（`recipes/*`） | 业务只发 `cue()`，由 recipe 决定声音 + 粒子 + DOM + 触感 |
| 分层弹跳 | `shared/feedback/mindmap-audio/layeredPops.ts` | 一次动作 = 一记，`count` 张对象 = 连弹几声 |

硬规则：**业务代码不直接调用 `playXxx()` 或裸建 `AudioContext`**。
业务声明「发生了什么」（`cue('grade.commit', …)`），由 recipe 决定听感；皮肤、稀有演出与 FX Lab
可在不改调用方的前提下替换或重放。

## 合成音数据源（`toneProfiles.ts`）

`ToneSpec` 字段即单个合成音的全部参数：

```ts
interface ToneSpec {
  frequency: number
  durationMs: number
  gain: number
  type: OscillatorType
  offsetMs: number
  endFrequency?: number   // 滑音终点频率
  pan?: number            // -1..1 立体声位置
  attackMs?: number
  envelope?: 'glass'     // 固定试听包络：4ms 起音后立即指数衰减，不受 origin 调制
}
```

### 三套音色与混合默认

用户保留试听页的三套终选，不按主题包着色。设置项是 `ReviewFeedbackSettings.soundVoice`：

| 值 | 听感 |
|---|---|
| `mixed` | **默认**。每次发声抽 `crystal` / `wood` / `celesta` 之一，同一句连弹不中途换 |
| `crystal` | 晶莹微风。调频玻璃，尾音中等 |
| `wood` | 禅境温木。低通木击，衰减封顶约 120ms |
| `celesta` | 灵音八音盒。延迟颤音，尾音最长 |

播放在 `playToneSequence` 里调用 `pickConcreteVoice` 一次，再把整句交给 `renderVoicedTone`。
主题包的 `colorTone` 不再改写播放。语义音高仍来自 `getToneSpec` / `buildGlassBell()`，音色只改变发声方式与音区。

响度在播放层放大（`SOUND_PRESENCE`），整句还有最低响度（`SEQUENCE_FLOOR`），所以微交互也不会发虚。
音量滑条仍然相乘；滑到 0 仍然静音。输出经过共享压缩器，连弹偏响但不削波。

`getToneSpec` 仍优先返回 `GLASS_PROFILES`，由 `layeredPops.ts` 的 `buildGlassBell()` 构造音高与间隔：

| 参数 | 值 |
|---|---|
| 基频 | `1318.5Hz`（与删除成功 toast 风铃同族） |
| 泛音 | `2.4×` 基频，增益比 `.15`，衰减 ×`.52` |
| 主音 | 语义增益 `.076`（播放再放大）、衰减 `380ms`、起音 `4ms` |
| 连弹间距 | 前 5 记 `82ms`；第 6 记起收成 `38ms` 轻尾巴 |
| 连弹音高 | 等程音阶模式 `[0, 0, 2, 0, 4]` 半音 |
| 连弹增益 | 前 5 记 `1 - i×.08`；之后 `max(.18, .57 - (i-5)×.055)` |
| 评分四档 | 忘记 `1×` / 困难 `9/8` / 良好 `5/4` / 简单 `4/3`，增益 `.82`、时长 ×`1.10` |

`envelope: 'glass'` 的音绕过 `tuneToneSpec`。三套音色和混合模式都绕过主题包着色；
烟花、连击和界面音走同一套音色解析，不再另走 pack timbre。

`TONE_PROFILES` 是 `Record<MindMapFeedbackEvent, ToneSpec[]>`，因此**新增事件时 TypeScript 会强制要求补配**，
不会静默回落。语义维度（用于"听声辨事"）如下：

| 语义维度 | 音色特征 | 代表事件 |
|---|---|---|
| 积极上行（创造/确认/成功） | 琶音上行、明亮高频、`sine`/`triangle` | `node_create`、`field_commit`、`save_success`、`card_reveal`、`session_complete` |
| 消极下行（删除/失败/危险） | 下行滑音、`sawtooth` + 低频、沉闷 | `node_delete`、`save_error` |
| 轻点选择（微操作） | 单短 `sine`、低 gain、pan 居中 | `pointer_down`、`node_select`、`key_press` |
| 结构变化（移动/拖拽） | 双音滑音、中频、pan 扩散 | `node_move`、`drag_start`、`drag_drop` |
| 导航切换（场景转换） | 双音大跨度、带 `screenPulse` | `navigation`、`mode_switch` |
| 里程碑（连击/通关/全清） | 多音和弦琶音 + 高频泛音、长 duration、pan 大幅扩散 | `import_apply`、`branch_clear`、`all_clear_ready`、`session_complete` |

局部与整体的区分由 `tuneToneSpec(event, tone, origin, audioScope)` 在 `origin` / `audioScope` 维度二次调制。
惊喜变体（如 `CARD_REVEAL_SURPRISE_TONES`）**不进入事件联合类型**，单独存放，避免污染事件表。

## 主题音色（`packTimbre.ts`）

主题包通过 `PackTimbre` 为**所有**程序化音出色，只调音高与包络，不使用采样：

| `PackTimbre` | 波形 | 音高倍率 | 时长倍率 | 起音倍率 | 增益倍率 | 听感 |
|---|---|---|---|---|---|---|
| `paper-wood` | `triangle` | 0.9 | 0.82 | 1.6 | 0.9 | 木质低沉 |
| `bell-lacquer` | `sine` | 1.18 | 1.35 | 0.35 | 0.85 | 漆器清亮 |
| `celesta-chime` | `sine` | 1.42 | 1.1 | 0.22 | 0.78 | 钢片琴高亮 |
| `marimba-water` | `triangle` | 0.78 | 1.05 | 0.7 | 1.0 | 马林巴温润 |

`colorTone(tone, timbre = activePackTimbre())` 是唯一着色入口；`attackMs` 最小 `2ms`、`durationMs` 最小 `18ms`，
避免调制后出现爆音或零时长。业务代码**不得按主题包 id 分支**（见 [theme-packs.md](./theme-packs.md)）。
`envelope: 'glass'` 的音在 `colorTone` 与 `tuneToneSpec` 中**原样返回**：用户选定的听感不随主题漂移。

## 分层弹跳（`layeredPops.ts`）

一次动作 = 一记 `role`；这次动作带动了几个对象 = `count`。**一次 `playToneSequence` 调用排完全部连弹**，
不能一张卡发一次 `cue()`——挂起上下文只保留最近一次声音（见上节），N 次调用会丢掉 N-1 记。

| 角色 | 用途 |
|---|---|
| `reveal` / `deal` | 翻卡 / 发牌（上行） |
| `fold` / `remove` / `unlink` | 折叠 / 删除 / 断边（下行 `.9` 倍音高） |
| `lift` | 单独删除、子级上移：按**被带动子级数**弹，不是被删那张 |
| `land` / `select` | 拖拽落定 / 选中 |
| `deny` | 无效操作：半频、`.52` 增益、`.7` 时长、无明亮泛音 |
| `close` | 单元完成：`4/3` 音高、`.65` 增益、`1.7` 时长 |
| `grade` | 评分四档，见上表 |

硬约束：张数上限 `40`（超出只留尾部轻响）；单张翻卡**不再**额外加引子，否则听起来是 N+1 张；
`count` 为非有限值或 `<= 0` 时返回空数组而不是发声。

## AudioContext 生命周期与 iOS 限制

`webAudioFeedback.ts` 维护**进程内单例** `sharedAudioContext`：

- 构造器解析兼容 `window.AudioContext ?? window.webkitAudioContext`；无可用构造器时返回 `null`（静默失败，不抛错）。
- **iOS Safari / PWA 只允许在用户手势调用栈内 `resume()`**，`interrupted` 与 `suspended` 一样不能出声。
  模块在 `touchstart` / `pointerdown` 上以 `{ passive: true, capture: true }` 提前尝试恢复（保持 passive，避免拖住随心滚动），
  并在 `touchend` / `pointerup` / `click` 上以 `{ passive: false, capture: true }` 再恢复一次。结束手势才稳定落在用户激活栈内。
  同一次手势会播放一段 1 采样静音 buffer，把输出真正接到硬件；只调用 `resume()` 时 WebKit 可能报成功但仍无声。
- 上下文还没进入 `running` 时**不排振荡器**。排进挂起或中断的时间线会在部分 WebKit 上整段丢失，或等恢复后补播成另一套音色。
  只保留最近一次、且不超过 450ms 的声音，等 `resume()` 或 `statechange` 进入 `running` 再播放。
- 从后台返回时 Web Audio 可能再次挂起或中断：`visibilitychange` 回到 `visible` 时重新 `resume()`。
  这次调用不在手势栈内，经常失败；下一次触摸结束会再试。
- 所有 `resume()` 失败均被吞掉，音频问题**绝不阻断交互**。
- 短音统一提前约 30ms 排程，包络时间严格递增。避免攻击段被当前时钟裁掉，或某一声部因非法 ramp 被丢掉，听起来像换了一个音效。
- 音量经 `clampFeedbackVolume` 钳制到 `[0, REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX]`；非有限值回落 `1`。

## 静音分区与音量优先级

### 界面音（`uiSounds.ts`）

- 全局**单一委托监听器**（`installUiSounds(isSuppressed)`），不给每个按钮挂监听。
- 开关条件：`soundEnabled && uiSoundEnabled !== false`。
- 频率限制：`MIN_GAP_MS = 45`ms，防止连点叠音。
- **静音分区** `SILENT_SCOPE = '[data-ui-sound="off"], .freestyle-stage, [data-freestyle-stage]'`：
  已有完整声音设计的面（随心舞台）**永不**收到通用界面音；需要静音的局部显式标注 `data-ui-sound="off"`。
- 目标映射 `classifyUiSoundTarget`：`switch`/`checkbox` 按**即将进入**的状态发声（`aria-checked` 翻转前取值）；
  `tab`/`radio`/`option`/`menuitem` → `wood-soft`；其余按钮 → `wood`；禁用、`aria-disabled`、`data-disabled` → `null`（静音）。

### 反馈导演通道（`shared/fx/core/policy.ts`）

`resolveFxGate(scene)` 是**唯一**把设置 + 系统减弱动效翻译成通道开关的地方（场景：`review` / `milestone` / `completion` / `ambient`）：

- 任一通道开前先看 `motion` 基础位：`prefers-reduced-motion` 关闭时 `baseMotion = false`，同时也会关掉触感。
- `sound` 需同时满足 `settings.soundEnabled` + 该场景的 `channels.*` + 场景自身 `enabled` + `soundEnabled`。
- `volume` 来自 `getSceneEffectiveVolume(settings, key)`，按场景独立。
- `completion` 额外受 `reducedCelebrationMotion` 抑制动效。
- `ambient` 永不发声、永不触感（只有视觉）。
- 三个通道全关时 `cue()` 直接返回 `null`，不创建 playback。

FX Lab 预览使用 `cue(name, sample, { force: true })`，其中 `FORCED` 门全开，仅用于试听/重放。

## 反馈导演的 owner 取消

所有延迟声音都挂在 `FxPlayback` 上（`at(ms, fn)` / `onCancel(fn)`）。
owner（一次卡片遭遇、一轮、一个页面）退役时 `retireOwner(owner)` 取消其全部待执行步骤，
**陈旧音效不可能落到下一张卡**。新增带延迟的声音必须走 playback，不得裸用 `setTimeout`。

## 禁止事项

- 业务组件不裸建 `AudioContext`、不直接 import `webAudioFeedback`（除非它就是音频通道实现本身）。
- 不新增音频素材文件；音色一律为合成参数。
- 不在 `toneProfiles` 之外另建事件→声音映射表（避免两处真相）。
- 不绕过 `resolveFxGate` 自行判断静音。
- 不让有独立声音设计的面同时收到通用界面音（必须列入 `SILENT_SCOPE`）。
- 不按主题包 id 在业务代码里分支选音。

## 验证

- 音色表与调制：`packTimbre.test.ts`、`toneProfiles` 相关测试、`webAudioFeedback.test.ts`
- 落地音与连击音：`landingChime.test.ts`
- 界面音：`uiSounds.test.ts`
- 通道门：`apps/web/src/shared/fx/core/policy.ts`（配合 `director.test.ts`）
- 主题整包：`apps/web/src/shared/theme/themePacks.test.ts`
- 全局门禁：`python tools/quality_gate.py`（交付前 `--full`）
