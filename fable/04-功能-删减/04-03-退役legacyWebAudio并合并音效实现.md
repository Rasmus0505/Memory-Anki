---
编号: 04-03
标题: 退役 legacyWebAudio 命名：音效数据统一并入 toneProfiles，引擎文件更名去 legacy 化
类型: 删减
范围: 功能
优先级: P2
预估工作量: M（2-8h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 04-03 退役 legacyWebAudio 并合并音效实现

## 1. 原始需求

`apps/web/src/shared/components/mindmap-host/` 下并存两个音效文件：
`legacyWebAudio.ts`（223 行）与 `toneProfiles.ts`（323 行）。

**两者关系核实结论**：它们不是新旧两套实现，而是"引擎 + 数据表"的分工——
`toneProfiles.ts` 是声音语义配置表（`TONE_PROFILES`、连击音 `getComboMilestoneTone`，文件头注释自称
"听声辨事的唯一数据源"）；`legacyWebAudio.ts` 是唯一的 Web Audio 播放引擎（`AudioContext` 管理、
iOS Safari 解锁、`scheduleTonePlayback` 调度、`tuneToneSpec` 调制），全仓再无第二个
`new AudioContext` 音效引擎（另一处 `webkitAudioContext` 在 `features/timer-overlay/TimerOverlayPage.tsx`，
是计时器提示音，独立场景，与本文档无关）。

真正的问题有两个：

1. **命名撒谎**：引擎并不 legacy，它被 `shared/feedback/feedbackCenter.ts`（第 6-10 行）和
   `useMindMapFeedback.ts`（第 10-14 行）作为现役唯一实现调用，`playLegacyFeedbackEvent` 等名字会误导
   后续代理以为存在一个"非 legacy 的新实现"可以替换它。
2. **数据表被绕过**：礼花音效数据 `getFireworkAccentTones`（`legacyWebAudio.ts` 第 174-208 行，约 35 行
   纯 ToneSpec 数据）内联在引擎文件里，违反 toneProfiles "唯一数据源"的既定约定。

目标：把礼花音效数据并入 `toneProfiles.ts`；引擎文件更名为 `webAudioFeedback.ts`，导出函数去掉
`Legacy` 字样；同步 4 个引用文件与 2 个测试文件。这是"合并 + 更名退役"，不删除任何行为。

## 2. 详细执行清单

### 步骤 1：改动前安全检查（引用面确认）

```powershell
cd D:\322321\Memory-Anki
rg -n "legacyWebAudio|playLegacy" apps/web/src
```

期望引用面**恰好是以下 6 个文件**（如有新增文件，把它们纳入后续步骤同样处理）：

1. `apps/web/src/shared/components/mindmap-host/legacyWebAudio.ts`（定义）
2. `apps/web/src/shared/components/mindmap-host/legacyWebAudio.test.ts`（引擎测试）
3. `apps/web/src/shared/components/mindmap-host/useMindMapFeedback.ts`（第 10-14、52、67 行）
4. `apps/web/src/shared/feedback/feedbackCenter.ts`（第 6-10、129、137、177 行）
5. `apps/web/src/shared/feedback/feedbackCenter.test.ts`（第 6-18、49-51 行，vi.mock 模块路径）
6. （无其他）

- **自查点**：引用面与上表一致。`apps/web/src/shared/components/mindmap-host/index.ts` 桶文件不含
  legacyWebAudio 导出（已核实），无需处理。

### 步骤 2：把礼花音效数据迁入 toneProfiles.ts

1. 打开 `apps/web/src/shared/components/mindmap-host/legacyWebAudio.ts`，剪切第 174-208 行的整个
   `function getFireworkAccentTones(kind, milestoneStep) { ... }`。
2. 打开 `apps/web/src/shared/components/mindmap-host/toneProfiles.ts`，粘贴到文件末尾（第 323 行
   `getToneSpec` 之后），并做两处修改：
   - 函数前加 `export`，加注释说明"礼花庆祝音数据，供 playWebAudioFireworkAccent 使用"；
   - 返回值中的字面量已带 `type: 'triangle' as const` 等断言，原样保留即可；为函数补上返回类型
     `: ToneSpec[]`。
3. 回到 `legacyWebAudio.ts`，在文件头第 3 行的 import 中追加 `getFireworkAccentTones`：

修改前：

```typescript
import { getComboMilestoneTone, getToneSpec, type ToneSpec } from './toneProfiles'
```

修改后：

```typescript
import {
  getComboMilestoneTone,
  getFireworkAccentTones,
  getToneSpec,
  type ToneSpec,
} from './toneProfiles'
```

- **自查点**：`cd apps/web && npm run typecheck` 通过；`legacyWebAudio.ts` 中不再有内联 ToneSpec 数组
  字面量（引擎文件只剩播放/调制逻辑）。

### 步骤 3：重命名导出函数（去 Legacy 字样）

在 `legacyWebAudio.ts` 中做纯重命名（函数体一字不改）：

| 旧名 | 新名 |
|---|---|
| `playLegacyFeedbackEvent` | `playWebAudioFeedbackEvent` |
| `playLegacyComboMilestone` | `playWebAudioComboMilestone` |
| `playLegacyFireworkAccent` | `playWebAudioFireworkAccent` |
| `__resetLegacyAudioContextForTests` | `__resetWebAudioContextForTests` |

（`tuneToneSpec` 不带 Legacy 字样，保持原名。）

- 不要重命名为 `playFeedbackEvent`——`feedbackCenter.ts` 已有 `playFeedbackAudio` 导出，名字太近容易
  在后续维护中混淆。
- **自查点**：`rg -n "playLegacy|__resetLegacy" apps/web/src/shared/components/mindmap-host/legacyWebAudio.ts`
  为空。

### 步骤 4：文件更名

```powershell
cd D:\322321\Memory-Anki
git mv apps/web/src/shared/components/mindmap-host/legacyWebAudio.ts apps/web/src/shared/components/mindmap-host/webAudioFeedback.ts
git mv apps/web/src/shared/components/mindmap-host/legacyWebAudio.test.ts apps/web/src/shared/components/mindmap-host/webAudioFeedback.test.ts
```

### 步骤 5：逐个更新 4 个引用文件

每个文件只改 import 路径与函数名，不改任何调用参数：

1. `apps/web/src/shared/components/mindmap-host/useMindMapFeedback.ts`（第 10-14 行）：

```typescript
import {
  playWebAudioComboMilestone,
  playWebAudioFeedbackEvent,
  tuneToneSpec,
} from './webAudioFeedback'
```

同时把第 52 行 `playLegacyFeedbackEvent({` 改为 `playWebAudioFeedbackEvent({`，
第 67 行 `playLegacyComboMilestone({` 改为 `playWebAudioComboMilestone({`。

2. `apps/web/src/shared/feedback/feedbackCenter.ts`（第 6-10 行）：

```typescript
import {
  playWebAudioComboMilestone,
  playWebAudioFeedbackEvent,
  playWebAudioFireworkAccent,
} from '@/shared/components/mindmap-host/webAudioFeedback'
```

同时更新第 129、137、177 行的三处调用名。

3. `apps/web/src/shared/feedback/feedbackCenter.test.ts`：把第 15 行
   `vi.mock('@/shared/components/mindmap-host/legacyWebAudio', ...)` 的模块路径改为
   `'@/shared/components/mindmap-host/webAudioFeedback'`，并把 mock 对象里（第 6-8、16-18 行）和断言里
   （第 49-51、78-105 行）的 `playLegacy*` 全部替换为对应 `playWebAudio*` 新名。**vi.mock 的路径必须与
   新文件名完全一致，否则 mock 失效、测试会真实创建 AudioContext 而失败。**

4. `apps/web/src/shared/components/mindmap-host/webAudioFeedback.test.ts`（原 legacyWebAudio.test.ts）：
   把第 77 行 `return import('./legacyWebAudio')` 改为 `return import('./webAudioFeedback')`，第 80 行
   describe 名与第 122 行解构的函数名同步更新。

- **自查点**：`rg -n "legacyWebAudio|playLegacy|__resetLegacy" apps/web/src` 为空。

### 步骤 6：全量验证

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run typecheck
npm run test
```

### 明确不要做的事

1. 不要修改任何 ToneSpec 数值（频率/时长/音量）——本文档零行为变化。
2. 不要动 `toneProfiles.ts` 里既有的 `TONE_PROFILES` 表和 `getToneSpec` / `getComboMilestoneTone`。
3. 不要动 `mindMapFeedbackAudioModel.ts`（优先级/合并节流模型）和 `hostBridgeUtils.ts`。
4. 不要动 `features/timer-overlay/TimerOverlayPage.tsx` 的独立提示音实现。
5. 不要试图"顺手"把 `useMindMapFeedback.ts` 与 `feedbackCenter.ts` 合并成一个入口——超出范围。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `rg -n "legacyWebAudio|playLegacy" apps/web/src` | 无任何匹配 |
| `cd apps/web && npm run typecheck` | 0 退出码 |
| `cd apps/web && npm run test` | 全部通过（含 webAudioFeedback.test.ts、feedbackCenter.test.ts、useMindMapFeedback.test.ts） |

### 行为验收（人工）

1. 开启沉浸反馈模式（个人设置里音效开关打开）→ 在思维导图里点击节点、翻卡 → 音效与改动前一致。
2. 复习中触发连击里程碑（3/5/8/13 连击）→ 升调连击音正常。
3. 复习完成触发庆祝礼花 → 礼花伴随音正常（数据已从引擎文件搬到 toneProfiles，音色不变）。

### 回归检查

- `feedbackCenter.notifyFeedback` 的 toast / 视觉 / 庆祝三条通路不受影响（只改了音频函数名）。
- iOS Safari PWA 的手势解锁监听（原文件第 26-42 行模块副作用）随文件整体迁移，不得删除。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实两文件为"引擎+数据表"关系、引擎为现役唯一实现、引用面共 5 个文件 | - |
