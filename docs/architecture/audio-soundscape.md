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
}
```

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

## AudioContext 生命周期与 iOS 限制

`webAudioFeedback.ts` 维护**进程内单例** `sharedAudioContext`：

- 构造器解析兼容 `window.AudioContext ?? window.webkitAudioContext`；无可用构造器时返回 `null`（静默失败，不抛错）。
- **iOS Safari / PWA 只允许在用户手势调用栈内 `resume()`**：模块在 `touchstart` / `pointerdown` / `click`
  上以 `{ passive: true, capture: true }` 注册解锁监听，首次手势即创建并恢复上下文。
- 从后台返回时 Web Audio 可能再次挂起：`visibilitychange` 回到 `visible` 时重新 `resume()`。
- 所有 `resume()` 失败均被吞掉（`.catch(() => undefined)`），音频问题**绝不阻断交互**。
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
