---
编号: 04-01
标题: 退役 features/palace-segments 伪 feature 目录，把共享展示逻辑迁到 entities/palace-segment
类型: 删减
范围: 功能
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 04-01 退役 palace-segments 伪 feature 目录

## 1. 原始需求

`apps/web/src/features/palace-segments/` 整个目录只剩一个文件：`model/segment-display.ts`（55 行），
内容是 4 个针对 `PalaceSegmentSummary` 的纯展示格式化函数（`formatSegmentDateTime`、
`formatRelativeReviewTime`、`formatCreatedAt`、`getSegmentDisplayName`）。它没有页面、没有组件、没有
hook，不是一个完整 feature，挂在 `features/` 下违反 Feature-Sliced Design 的层次语义（历史上该目录的
API 文件已被迁走——见 `tools/check_architecture.py` 第 53 行的禁止回迁条目
`features/palace-segments/api/palaceSegmentsApi.ts`，model 是最后的残留）。

经全仓 grep 核实（`rg "features/palace-segments" apps`），**当前只有 1 个调用方**：

```5:8:apps/web/src/features/palace-edit/components/PalaceSegmentsPanel.tsx
import {
  formatSegmentDateTime,
  getSegmentDisplayName,
} from '@/features/palace-segments/model/segment-display'
```

且调用方只用到 4 个函数中的 2 个（`formatSegmentDateTime`、`getSegmentDisplayName`）。另外 2 个函数
（`formatRelativeReviewTime`、`formatCreatedAt`）在 `apps/web/src/features/palace-catalog/components/palace-list/utils.ts`
第 129、212 行有各自独立的实现，palace-catalog 从不 import 本目录——即这 2 个函数是死代码。

目标：把仍被使用的 2 个函数迁到实体层 `apps/web/src/entities/palace-segment/model/`（分段展示逻辑属于
palace-segment 实体，与已有的 `entities/palace-segment/api/` 对齐），删除死函数，删除整个
`features/palace-segments/` 目录。

## 2. 详细执行清单

### 步骤 1：删除前安全检查（引用面确认）

在仓库根目录执行：

```powershell
cd D:\322321\Memory-Anki
rg -n "features/palace-segments" apps
```

期望输出**只有 1 个代码调用方**：`apps/web/src/features/palace-edit/components/PalaceSegmentsPanel.tsx`
（第 8 行），外加 `tools/check_architecture.py` 第 53 行的一条防回迁配置（那是字符串常量，不是 import，
不需要改）。如果出现了其他 `apps/web` 内的调用方，把它们记下来，在步骤 4 一并改 import。

再确认死函数无人使用：

```powershell
rg -n "formatRelativeReviewTime|formatCreatedAt" apps/web/src --glob "!**/palace-catalog/**" --glob "!**/palace-segments/**"
```

期望输出为空（palace-catalog 用的是自己 utils.ts 里的同名副本，与本目录无关）。

- **自查点**：两条 rg 的结果与上述期望一致。

### 步骤 2：新建 entities/palace-segment/model/segment-display.ts

新建文件 `apps/web/src/entities/palace-segment/model/segment-display.ts`，完整内容如下
（= 原文件第 1-6 行 + 第 45-55 行，去掉死函数和不再需要的 `parseApiDateTime` import）：

```typescript
import type { PalaceSegmentSummary } from '@/shared/api/contracts'
import { formatApiDateTime } from '@/shared/lib/dateTime'

export function formatSegmentDateTime(value: string | null) {
  return value ? formatApiDateTime(value).slice(0, 16) : '未设置'
}

export function getSegmentDisplayName(
  segment: PalaceSegmentSummary,
  index: number,
): string {
  if (segment.display_name) return segment.display_name
  if (segment.is_virtual_default) return '第 1 学习组'
  if (/^第\s*1\s*学习组$/.test(segment.name)) {
    return `第 ${index + 1} 学习组`
  }
  return segment.name
}
```

- 不要把 `formatRelativeReviewTime`、`formatCreatedAt` 一起搬过去（它们是死代码，本次直接消亡）。
- **自查点**：新文件只有 2 个 export，且函数体与原 `features/palace-segments/model/segment-display.ts`
  第 4-6、45-55 行逐字一致。

### 步骤 3：把新模块挂进 entities/palace-segment 桶文件

打开 `apps/web/src/entities/palace-segment/index.ts`，当前内容只有一行：

修改前：

```typescript
export * from './api'
```

修改后：

```typescript
export * from './api'
export * from './model/segment-display'
```

- **自查点**：`rg -n "export" apps/web/src/entities/palace-segment/index.ts` 显示 2 行。

### 步骤 4：改掉唯一调用方的 import

打开 `apps/web/src/features/palace-edit/components/PalaceSegmentsPanel.tsx`，找到第 5-8 行：

修改前：

```typescript
import {
  formatSegmentDateTime,
  getSegmentDisplayName,
} from '@/features/palace-segments/model/segment-display'
```

修改后：

```typescript
import {
  formatSegmentDateTime,
  getSegmentDisplayName,
} from '@/entities/palace-segment'
```

- 不要动该文件的其他 import（第 4 行 `formatDuration` 来自 `@/entities/session/model`，与本文档无关）。
- 不要改动组件体内第 140、144、164 行对这两个函数的调用。
- **自查点**：`rg -n "features/palace-segments" apps/web/src` 结果为空。

### 步骤 5：删除伪 feature 目录

删除整个目录 `apps/web/src/features/palace-segments/`（其下只有 `model/segment-display.ts` 一个文件）。

- 不要动 `apps/web/src/entities/palace-segment/`（那是本次迁入的目的地）。
- 不要动 `tools/check_architecture.py`（第 53 行的防回迁条目继续有效，正好防止未来有人重建该目录）。
- **自查点**：`Test-Path apps/web/src/features/palace-segments` 返回 `False`。

### 步骤 6：全量验证

```powershell
cd D:\322321\Memory-Anki\apps\web
npm run typecheck
npm run test
```

### 明确不要做的事

1. 不要"顺手"合并 `palace-catalog/components/palace-list/utils.ts` 里的同名函数副本——那是另一个 feature
   自己的实现，不在本文档范围。
2. 不要把 segment-display 迁到 `shared/`——`shared` 不允许依赖实体类型语义之外的内容，且此逻辑只服务
   palace-segment 实体。
3. 不要修改 `entities/palace-segment/api/` 下任何文件。
4. 不要动后端（`apps/api`）任何文件。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `rg -n "features/palace-segments" apps/web/src` | 无任何匹配 |
| `rg -n "formatRelativeReviewTime|formatCreatedAt" apps/web/src/entities/palace-segment` | 无任何匹配（死函数未被搬运） |
| `cd apps/web && npm run typecheck` | 0 退出码 |
| `cd apps/web && npm run test` | 全部通过 |
| `python tools/check_architecture.py` | 不出现 palace-segments 相关新报错（仓库当前存在的其他既有报错不计） |

### 行为验收（人工）

1. 打开某个宫殿的编辑页（`/palaces/:id/edit`）→ 右侧"学习组"面板正常显示分段名称（如"第 1 学习组"）
   和创建时间（`formatSegmentDateTime` 输出，格式 `YYYY-MM-DD HH:mm`）。
2. 面板中点开某分段的"下次复习"编辑框 → 时间值正常显示。

### 回归检查

- 宫殿列表页（`/palaces/list`）的分段展示不受影响——它用的是 palace-catalog 自己的 utils.ts。
- `entities/palace-segment/api` 的增删查接口封装不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实目录仅 1 文件 55 行、唯一调用方 PalaceSegmentsPanel.tsx 第 5-8 行、2 个函数为死代码 | - |
