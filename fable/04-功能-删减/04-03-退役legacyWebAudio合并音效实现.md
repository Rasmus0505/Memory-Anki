---
编号: 04-03
标题: 退役 legacyWebAudio 的误导性 legacy 命名——核实后确认它是现役音效引擎，重命名而非删除
类型: 删减
范围: 功能
优先级: P2
预估工作量: M（2-8h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker / Codex同步
完成时间: 2026-07-09
---

# 04-03 退役 legacyWebAudio 的 legacy 命名（重命名方案）

## 1. 原始需求

`apps/web/src/shared/components/mindmap-host/legacyWebAudio.ts`（实测 223 行）命名带 legacy，与同目录 `toneProfiles.ts`（实测 323 行）并存，容易被误判为"遗留的重复音效实现，可以删掉一个"。经核实（2026-07-08），**两者不是重复实现，而是分层关系，一个都不能删**：

- `toneProfiles.ts` 是纯数据表：`ToneSpec` 类型 + 每个 `MindMapFeedbackEvent` 对应的合成音配置（`TONE_PROFILES`）+ `getToneSpec` / `getComboMilestoneTone` 查表函数。它唯一的消费者就是 `legacyWebAudio.ts`（第 3 行 import）。
- `legacyWebAudio.ts` 是播放引擎：共享 `AudioContext` 管理、iOS Safari 手势解锁（26–42 行）、`tuneToneSpec` 二次调制（58–92 行）、`scheduleTonePlayback` / `playToneSequence` 调度（94–146 行），对外导出 `playLegacyFeedbackEvent`、`playLegacyComboMilestone`、`playLegacyFireworkAccent`、`__resetLegacyAudioContextForTests`。
- 现役调用方共 4 个文件：`shared/feedback/feedbackCenter.ts`（第 6–10 行，import 三个 play 函数，是全局反馈中心的**唯一音频出口**）、`feedbackCenter.test.ts`（第 15 行 vi.mock 模块路径）、`shared/components/mindmap-host/useMindMapFeedback.ts`（第 10–14 行）、`legacyWebAudio.test.ts`。

与任务假设不符之处：不存在"合并/退役其中一个"的空间——删除 `legacyWebAudio.ts` 会让全站音效（复习、做题、计时器、全局反馈）全部失声；把 323 行数据表并进 223 行引擎会得到一个约 550 行的数据+逻辑混合文件，反而降低可读性。真正的问题只有**误导性的 legacy 命名**（文件名 + 4 个导出符号名），它诱导后续代理误删现役代码。本文档的删减对象是"legacy 这个名字"，方案为重命名。

## 2. 详细执行清单

### 步骤 0：删除/重命名前的安全检查清单（必须先做）

```powershell
# 检查 1：确认 legacyWebAudio 的全部引用方（应恰好 4 个文件 + 自身）
rg "legacyWebAudio" apps/web/src
# 期望输出涉及文件：
#   shared/feedback/feedbackCenter.ts
#   shared/feedback/feedbackCenter.test.ts
#   shared/components/mindmap-host/useMindMapFeedback.ts
#   shared/components/mindmap-host/legacyWebAudio.test.ts
#   shared/components/mindmap-host/legacyWebAudio.ts（自身）

# 检查 2：确认 toneProfiles 只被引擎消费
rg "toneProfiles|getToneSpec|getComboMilestoneTone|CARD_REVEAL_SURPRISE_TONES" apps/web/src --glob "!**/toneProfiles.ts"
# 期望输出：只有 legacyWebAudio.ts 一处 import
# （features/english/useEnglishTypingFeedbackSounds.ts 里有一个自己的局部 ToneSpec interface，
#   与本目录无关，不要动它）

# 检查 3：确认待改名的导出符号的全部使用点
rg "playLegacyFeedbackEvent|playLegacyComboMilestone|playLegacyFireworkAccent|__resetLegacyAudioContextForTests" apps/web/src
# 期望输出：定义处 + feedbackCenter.ts / feedbackCenter.test.ts / useMindMapFeedback.ts / legacyWebAudio.test.ts

# 检查 4：确认 mindmap-host/index.ts 没有导出音频符号（改名不影响 barrel）
Get-Content apps/web/src/shared/components/mindmap-host/index.ts
# 期望输出：只导出 MindMapFrame / MindMapPageToolbar 及类型，无音频相关导出
```

### 步骤 1：文件改名

```powershell
cd apps/web/src/shared/components/mindmap-host
git mv legacyWebAudio.ts feedbackAudioEngine.ts
git mv legacyWebAudio.test.ts feedbackAudioEngine.test.ts
```

自查点：`git status` 显示两个 renamed 条目。

### 步骤 2：改导出符号名（只改 4 个带 Legacy 的）

打开 `apps/web/src/shared/components/mindmap-host/feedbackAudioEngine.ts`，做以下 4 处重命名（用编辑器精确替换，不要全局正则替换整个仓库）：

| 修改前 | 修改后 | 定义行（原文件） |
|---|---|---|
| `playLegacyFeedbackEvent` | `playFeedbackEventTones` | 148 行 |
| `playLegacyComboMilestone` | `playComboMilestoneTones` | 164 行 |
| `playLegacyFireworkAccent` | `playFireworkAccentTones` | 210 行 |
| `__resetLegacyAudioContextForTests` | `__resetFeedbackAudioContextForTests` | 221 行 |

命名说明：加 `Tones` 后缀是为了与 `feedbackCenter.ts` 里已存在的高层封装 `playFeedbackAudio`（122 行）区分开，避免两个层级出现同名函数。

不要做什么：
- 不要改 `tuneToneSpec`、`scheduleTonePlayback`、`getSharedAudioContext` 等其余函数名。
- 不要动 `toneProfiles.ts` 的任何内容。
- 不要"顺手"把 iOS 解锁监听逻辑（26–42 行）改成 hook——那是模块副作用，行为已被 `legacyWebAudio.test.ts`（改名后 `feedbackAudioEngine.test.ts`）锁定。

### 步骤 3：同步 4 个引用文件

3a. `apps/web/src/shared/feedback/feedbackCenter.ts` 第 6–10 行：

```typescript
// 修改前
import {
  playLegacyComboMilestone,
  playLegacyFeedbackEvent,
  playLegacyFireworkAccent,
} from '@/shared/components/mindmap-host/legacyWebAudio'
// 修改后
import {
  playComboMilestoneTones,
  playFeedbackEventTones,
  playFireworkAccentTones,
} from '@/shared/components/mindmap-host/feedbackAudioEngine'
```

同文件内 3 处调用点同步改名：128 行 `playLegacyComboMilestone(` → `playComboMilestoneTones(`；137 行 `playLegacyFeedbackEvent(` → `playFeedbackEventTones(`；177 行 `playLegacyFireworkAccent(` → `playFireworkAccentTones(`。

3b. `apps/web/src/shared/feedback/feedbackCenter.test.ts` 第 15 行附近：`vi.mock('@/shared/components/mindmap-host/legacyWebAudio', ...)` 的模块路径改为 `feedbackAudioEngine`，mock 工厂里返回的函数名同步改为新名。**vi.mock 是字符串路径，typecheck 抓不到它，漏改会让测试悄悄失效，必须靠步骤 4 的 grep 自查兜底。**

3c. `apps/web/src/shared/components/mindmap-host/useMindMapFeedback.ts` 第 10–14 行：

```typescript
// 修改前
import {
  playLegacyComboMilestone,
  playLegacyFeedbackEvent,
  tuneToneSpec,
} from './legacyWebAudio'
// 修改后
import {
  playComboMilestoneTones,
  playFeedbackEventTones,
  tuneToneSpec,
} from './feedbackAudioEngine'
```

同文件 52 行、67 行两处调用点同步改名。第 100 行 `export { tuneToneSpec }` 不变。

3d. `apps/web/src/shared/components/mindmap-host/feedbackAudioEngine.test.ts`：文件内所有 `import('./legacyWebAudio')`（原第 77 行）改为 `import('./feedbackAudioEngine')`，describe 文案里的 legacyWebAudio 字样可一并更新；如用到 `__resetLegacyAudioContextForTests` 也同步改名。

### 步骤 4：清扫自查

```powershell
rg -i "legacywebaudio|playLegacy|__resetLegacyAudio" apps/web/src
# 期望输出：空
```

### 回滚方式

```powershell
# 未提交：
git checkout -- apps/web/src/shared/components/mindmap-host apps/web/src/shared/feedback
# 已提交：
git revert <提交 hash>
```

纯重命名，无数据、无接口变化，回滚零风险。

## 3. 测试验收标准

可执行命令：

```powershell
cd apps/web
npm run typecheck   # 期望：0 error
npm run lint        # 期望：0 error
npm run test        # 期望：全部通过；重点确认 feedbackAudioEngine.test.ts、
                    # feedbackCenter.test.ts、useMindMapFeedback.test.ts 在列且通过
```

行为验收（音效必须真实可听，PWA 与桌面端各验一遍）：

- 打开 `/review/feedback-preview`（反馈预览页）→ 逐个触发事件音效，有声且与改动前一致。
- 复习流程：翻卡、分支清空、连击里程碑 → 对应音效正常。
- `/profile/feedback` 设置页 → 音量滑块、静音开关仍然生效。
- iOS Safari PWA（Tailscale 入口）→ 首次触摸后音效可播放（验证手势解锁副作用没被破坏）。

回归检查：

- `toneProfiles.ts` 的 `git diff` 必须为空。
- 英语打字音效（`useEnglishTypingFeedbackSounds.ts`）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | fable 文档代理 | 文档创建；核实两文件为"数据表+引擎"分层而非重复实现，结论改为重命名退役 legacy 命名 | 待执行 |
| 2026-07-09 | Codex | 同步同编号主文档完成状态 | 对应主文档 `04-03-退役legacyWebAudio并合并音效实现.md` 已完成；legacy 命名已退役并保留音效行为，本文档作为同编号副本标记完成，避免重复认领。 |
