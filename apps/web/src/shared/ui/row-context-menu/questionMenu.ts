import { CheckSquare, Copy, Flag, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { composeMenu, menuItem } from './compose'
import type { RowMenuEntry } from './RowContextMenu'

/**
 * Every place that lists a question builds its right-click menu here.
 *
 * The verbs are the same product language whether the row lives in 做题卡片,
 * 题库管理 or 全局搜索; a host hides the ones it cannot support instead of
 * growing a second menu with a different order. Sections keep the app's common
 * shape: edit → work on this question → copy → destructive.
 */
export interface QuestionMenuActions {
  edit?: { onSelect: () => void; disabled?: boolean }
  /** 再做一次: clear this question's local progress and answer it again. */
  redo?: { onSelect: () => void }
  mark?: { marked: boolean; onSelect: () => void }
  /** 题库管理's checkbox verb. */
  select?: { selected: boolean; onSelect: () => void }
  copyStem?: { stem: string }
  remove?: { onSelect: () => void; disabled?: boolean }
}

export function buildQuestionMenu(actions: QuestionMenuActions): RowMenuEntry[] {
  const stem = actions.copyStem?.stem
  return composeMenu(
    [
      actions.edit
        ? menuItem('编辑题目', Pencil, actions.edit.onSelect, { disabled: actions.edit.disabled })
        : null,
    ],
    [
      actions.redo ? menuItem('再做一次', RotateCcw, actions.redo.onSelect) : null,
      actions.mark
        ? menuItem(actions.mark.marked ? '取消标记' : '标记题目', Flag, actions.mark.onSelect)
        : null,
      actions.select
        ? menuItem(
          actions.select.selected ? '取消选择' : '选择题目',
          CheckSquare,
          actions.select.onSelect,
        )
        : null,
    ],
    [
      stem != null
        ? menuItem('复制题干', Copy, () => {
          void navigator.clipboard?.writeText(stem).catch(() => undefined)
        })
        : null,
    ],
    [
      actions.remove
        ? menuItem('删除题目', Trash2, actions.remove.onSelect, {
          danger: true,
          disabled: actions.remove.disabled,
        })
        : null,
    ],
  )
}
