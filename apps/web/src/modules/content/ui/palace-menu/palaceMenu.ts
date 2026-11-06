import {
  Brain,
  ClipboardCopy,
  FileQuestion,
  FolderInput,
  FolderTree,
  ListChecks,
  Network,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import type { RowMenuEntry } from '@/shared/ui/row-context-menu/RowContextMenu'
import { composeMenu, menuItem, type MenuSection } from '@/shared/ui/row-context-menu/compose'

/** One slot of a menu: the verb, its handler, and whether it can run now. */
export interface MenuAction {
  label?: string
  onSelect: () => void
  disabled?: boolean
}

export interface PalaceMenuParts {
  /** Opening the palace somewhere (editor, freestyle card, lookup). */
  open?: MenuAction
  progress?: MenuAction
  quiz?: MenuAction
  freestyle?: MenuAction
  /** Inline rename is drawn by the row itself; hosts outside a tree pass a prompt. */
  rename?: MenuAction
  move?: MenuAction
  favorite?: { isFavorite: boolean; onSelect: () => void }
  copyLink?: MenuAction
  /** Host-specific verbs (复习进度面板, 导出…), shown above the destructive item. */
  extra?: MenuSection
  remove?: MenuAction
}

export interface ChapterMenuParts {
  createPalace?: MenuAction
  freestyle?: MenuAction
  rename?: MenuAction
  moveChapters?: MenuAction
  extra?: MenuSection
  remove?: MenuAction
}

export interface SubjectMenuParts {
  openShelf?: MenuAction
  openKnowledge?: MenuAction
  createPalace?: MenuAction
  rename?: MenuAction
  extra?: MenuSection
  remove?: MenuAction
}

function entry(action: MenuAction | undefined, label: string, icon: Parameters<typeof menuItem>[1]) {
  if (!action) return null
  return menuItem(action.label ?? label, icon, action.onSelect, { disabled: action.disabled })
}

/** 打开 → 复习 → 整理（改名/搬家/收藏/复制）→ 删除, for one palace row. */
export function buildPalaceMenu(parts: PalaceMenuParts): RowMenuEntry[] {
  return composeMenu(
    [
      entry(parts.open, '打开', FolderTree),
      entry(parts.progress, '复习进度', ListChecks),
      entry(parts.quiz, '做题', FileQuestion),
      entry(parts.freestyle, '开始随心复习', Brain),
    ],
    [
      entry(parts.rename, '重命名', Pencil),
      entry(parts.move, '移动到…', FolderInput),
      parts.favorite
        ? menuItem(
          parts.favorite.isFavorite ? '取消收藏' : '收藏',
          parts.favorite.isFavorite ? StarOff : Star,
          parts.favorite.onSelect,
        )
        : null,
      entry(parts.copyLink, '复制链接', ClipboardCopy),
    ],
    parts.extra,
    parts.remove
      ? menuItem(parts.remove.label ?? '删除宫殿', Trash2, parts.remove.onSelect, {
        danger: true,
        disabled: parts.remove.disabled,
      })
      : null,
  )
}

export function buildChapterMenu(parts: ChapterMenuParts): RowMenuEntry[] {
  return composeMenu(
    [
      entry(parts.createPalace, '在此章节新建宫殿', Plus),
      entry(parts.freestyle, '开始随心复习', Brain),
    ],
    [
      entry(parts.rename, '重命名', Pencil),
      entry(parts.moveChapters, '调整章节层级…', FolderInput),
    ],
    parts.extra,
    parts.remove
      ? menuItem(parts.remove.label ?? '删除章节', Trash2, parts.remove.onSelect, {
        danger: true,
        disabled: parts.remove.disabled,
      })
      : null,
  )
}

export function buildSubjectMenu(parts: SubjectMenuParts): RowMenuEntry[] {
  return composeMenu(
    [
      entry(parts.openShelf, '打开学科书架', FolderTree),
      entry(parts.openKnowledge, '在知识库编辑章节', Network),
      entry(parts.createPalace, '在此学科新建宫殿', Plus),
    ],
    [entry(parts.rename, '重命名', Pencil)],
    parts.extra,
    parts.remove
      ? menuItem(parts.remove.label ?? '删除学科', Trash2, parts.remove.onSelect, {
        danger: true,
        disabled: parts.remove.disabled,
      })
      : null,
  )
}
