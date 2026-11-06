import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/shared/feedback/toast'
import { appConfirm, appPrompt } from '@/shared/components/ui/native-dialog'
import type { RowMenuEntry } from '@/shared/ui/row-context-menu/RowContextMenu'
import { generateLocalId } from '@/shared/lib/ids'
import {
  createPalaceApi,
  deletePalaceApi,
  getPalaceApi,
  invalidatePalaceCatalogCache,
  updatePalaceApi,
} from '@/modules/content/domain/palace-entity/api'
import { updatePalaceKnowledgeBindingApi } from '@/modules/content/domain/palace-entity/api/practiceApi'
import {
  DeleteChapterImpactError,
  DeleteSubjectImpactError,
  deleteChapterApi,
  deleteSubjectApi,
  updateChapterApi,
  updateSubjectApi,
} from '@/modules/content/domain/knowledge-entity/api'
import { setPalaceFavorite } from '@/modules/content/ui/palace-favorite'
import { MovePalaceDialog, type ChapterTarget } from './MovePalaceDialog'
import {
  buildChapterMenu,
  buildPalaceMenu,
  buildSubjectMenu,
  type MenuAction,
} from './palaceMenu'

export interface PalaceMenuTarget {
  id: number
  title: string
  isFavorite?: boolean
}

export interface ChapterMenuTarget {
  id: number
  name: string
  subjectId: number
}

export interface SubjectMenuTarget {
  id: number
  name: string
}

/** Verbs a host can hide when they do not apply (a dialog row cannot "open" itself). */
export type PalaceMenuVerb =
  | 'progress'
  | 'quiz'
  | 'freestyle'
  | 'rename'
  | 'move'
  | 'favorite'
  | 'copyLink'
  | 'remove'

export interface PalaceMenuCallOptions {
  /** Replace the default 「打开」 (editor page opens in place, freestyle jumps the feed). */
  open?: MenuAction
  /** Replace the default 「复习进度」 (the catalog opens its in-place panel). */
  progress?: MenuAction
  /** Inline rename supplied by a tree row; omitted, the menu asks with a prompt. */
  rename?: MenuAction
  /** Host verbs, drawn above the destructive item. */
  isFavorite?: boolean
  omit?: PalaceMenuVerb[]
}

export interface ChapterMenuCallOptions {
  rename?: MenuAction
  omit?: Array<'createPalace' | 'freestyle' | 'rename' | 'remove'>
}

export interface SubjectMenuCallOptions {
  rename?: MenuAction
  omit?: Array<'openShelf' | 'openKnowledge' | 'createPalace' | 'rename' | 'remove'>
}

export interface PalaceMenuActionsOptions {
  /** Called after any mutation lands (rename / move / favorite / delete). */
  onChanged?: (id: number) => void | Promise<void>
  /** Called after a palace was deleted, before the list refreshes. */
  onDeleted?: (palaceId: number) => void
  /**
   * Runs before the binding write; returning false aborts the move.
   *
   * The editor uses it to flush unsaved canvas edits and ask before discarding
   * them, because moving the palace that is open on screen reloads its document.
   */
  beforeMove?: (palaceId: number, target: ChapterTarget) => Promise<boolean>
  /** Where 「打开」 goes when a host does not override it. */
  openPath?: (palaceId: number) => string
}

const DEFAULT_OPEN_PATH = (palaceId: number) => `/palaces/${palaceId}/edit`

/**
 * One place that knows what can be done to a palace / chapter / subject.
 *
 * Every list (editor directory, shelf, freestyle rail, knowledge page, search
 * results) builds its right-click menu here, so a verb keeps its label, icon,
 * confirmation copy and side effects no matter where it was opened from.
 */
export function usePalaceMenuActions(options: PalaceMenuActionsOptions = {}) {
  const navigate = useNavigate()
  const { onChanged, onDeleted, openPath = DEFAULT_OPEN_PATH, beforeMove } = options
  const [moveTarget, setMoveTarget] = useState<{
    id: number
    title: string
    currentChapterId: number | null
  } | null>(null)

  const afterMutation = useCallback(async (id: number) => {
    invalidatePalaceCatalogCache()
    await onChanged?.(id)
  }, [onChanged])

  const renamePalaceTo = useCallback(async (palaceId: number, nextTitle: string) => {
    const title = nextTitle.trim()
    if (!title) return
    try {
      await updatePalaceApi(palaceId, { title })
      await afterMutation(palaceId)
      toast.success(`已改名为「${title}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '改名失败，请稍后重试。')
    }
  }, [afterMutation])

  const bindPalace = useCallback(async (palaceId: number, target: ChapterTarget) => {
    if (beforeMove && !(await beforeMove(palaceId, target))) return false
    const detail = await getPalaceApi(palaceId)
    const subjectIds = (detail.subjects ?? []).map((subject) => subject.id)
    // Keep the other subjects a palace is studied under; only chapter placement
    // changes here. (The editor's drag asks before dropping a subject.)
    const nextSubjectIds = subjectIds.includes(target.subjectId)
      ? subjectIds
      : [...subjectIds, target.subjectId]
    await updatePalaceKnowledgeBindingApi(palaceId, {
      subject_ids: nextSubjectIds,
      chapter_ids: target.chapterId == null ? [] : [target.chapterId],
      primary_chapter_id: target.chapterId,
      base_revision: detail.binding_revision ?? 0,
      operation_id: generateLocalId(),
    })
    return true
  }, [beforeMove])

  const applyMove = useCallback(async (palaceId: number, target: ChapterTarget) => {
    try {
      if (!(await bindPalace(palaceId, target))) return
      await afterMutation(palaceId)
      toast.success(target.chapterId == null ? '已移出章节' : `已移动到「${target.chapterName}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移动失败，请稍后重试。')
      throw error
    }
  }, [afterMutation, bindPalace])

  const removePalace = useCallback(async (palace: PalaceMenuTarget) => {
    const confirmed = await appConfirm(
      `删除宫殿「${palace.title}」？脑图、章节绑定和练习记录会一起删除。`,
      { title: '删除宫殿', confirmText: '删除宫殿', tone: 'danger' },
    )
    if (!confirmed) return
    try {
      await deletePalaceApi(palace.id)
      onDeleted?.(palace.id)
      invalidatePalaceCatalogCache()
      await onChanged?.(palace.id)
      toast.success(`已删除「${palace.title}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败，请稍后重试。')
    }
  }, [onChanged, onDeleted])

  const toggleFavorite = useCallback(async (palace: PalaceMenuTarget, isFavorite: boolean) => {
    try {
      await setPalaceFavorite(palace.id, !isFavorite)
      toast.success(isFavorite ? '已取消收藏' : '已收藏')
      await onChanged?.(palace.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '收藏没保存成功')
    }
  }, [onChanged])

  const copyLink = useCallback(async (palaceId: number) => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}${openPath(palaceId)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('链接已复制')
    } catch {
      toast.error(`复制失败，链接是 ${url}`)
    }
  }, [openPath])

  const openMoveDialog = useCallback(async (palace: PalaceMenuTarget) => {
    let currentChapterId: number | null = null
    try {
      const detail = await getPalaceApi(palace.id)
      currentChapterId = detail.primary_chapter_id ?? null
    } catch {
      // A failed detail read only costs the 「当前」 marker, not the move itself.
    }
    setMoveTarget({ id: palace.id, title: palace.title, currentChapterId })
  }, [])

  const renameWithPrompt = useCallback(async (palace: PalaceMenuTarget) => {
    const next = await appPrompt('新的宫殿名', {
      title: '重命名宫殿',
      defaultValue: palace.title,
      confirmText: '保存',
    })
    if (next == null) return
    await renamePalaceTo(palace.id, next)
  }, [renamePalaceTo])

  const palaceMenu = useCallback((
    palace: PalaceMenuTarget,
    call: PalaceMenuCallOptions = {},
  ): RowMenuEntry[] => {
    const omit = new Set(call.omit ?? [])
    // Only offer 收藏 when the host actually knows the state. Showing 「收藏」 for
    // an already-favorited palace makes the item unable to unfavorite it.
    const isFavorite = call.isFavorite ?? palace.isFavorite
    return buildPalaceMenu({
      open: call.open ?? { onSelect: () => navigate(openPath(palace.id)) },
      progress: omit.has('progress')
        ? undefined
        : call.progress ?? { onSelect: () => navigate(`/palaces/${palace.id}/units`) },
      quiz: omit.has('quiz')
        ? undefined
        : { onSelect: () => navigate(`/palaces/${palace.id}/quiz`) },
      freestyle: omit.has('freestyle')
        ? undefined
        : { onSelect: () => navigate(`/freestyle?palaceId=${palace.id}`) },
      rename: omit.has('rename')
        ? undefined
        : call.rename ?? { onSelect: () => void renameWithPrompt(palace) },
      move: omit.has('move')
        ? undefined
        : { onSelect: () => void openMoveDialog(palace) },
      favorite: omit.has('favorite') || isFavorite === undefined
        ? undefined
        : { isFavorite, onSelect: () => void toggleFavorite(palace, isFavorite) },
      copyLink: omit.has('copyLink')
        ? undefined
        : { onSelect: () => void copyLink(palace.id) },
      remove: omit.has('remove')
        ? undefined
        : { onSelect: () => void removePalace(palace) },
    })
  }, [
    copyLink,
    navigate,
    openMoveDialog,
    openPath,
    removePalace,
    renameWithPrompt,
    toggleFavorite,
  ])

  const createPalaceIn = useCallback(async (subjectId: number, chapterId: number | null) => {
    try {
      const created = await createPalaceApi({ title: '新建宫殿', subject_ids: [subjectId] })
      if (chapterId != null) {
        const detail = await getPalaceApi(created.id)
        await updatePalaceKnowledgeBindingApi(created.id, {
          subject_ids: [subjectId],
          chapter_ids: [chapterId],
          primary_chapter_id: chapterId,
          base_revision: detail.binding_revision ?? 0,
          operation_id: generateLocalId(),
        })
      }
      invalidatePalaceCatalogCache()
      toast.success('已新建宫殿')
      navigate(`/palaces/${created.id}/edit`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '新建宫殿失败，请稍后重试。')
    }
  }, [navigate])

  const renameChapterTo = useCallback(async (chapterId: number, nextName: string) => {
    const name = nextName.trim()
    if (!name) return
    try {
      await updateChapterApi(chapterId, { name })
      await afterMutation(chapterId)
      toast.success(`已改名为「${name}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '改名失败，请稍后重试。')
    }
  }, [afterMutation])

  const renameChapterWithPrompt = useCallback(async (chapter: ChapterMenuTarget) => {
    const next = await appPrompt('新的章节名', {
      title: '重命名章节',
      defaultValue: chapter.name,
      confirmText: '保存',
    })
    if (next == null) return
    await renameChapterTo(chapter.id, next)
  }, [renameChapterTo])

  const removeChapter = useCallback(async (chapter: ChapterMenuTarget) => {
    const confirmed = await appConfirm(
      `删除章节「${chapter.name}」？它下面的子章节会一起删除。`,
      { title: '删除章节', confirmText: '删除章节', tone: 'danger' },
    )
    if (!confirmed) return
    const remove = async (force: boolean) => {
      await deleteChapterApi(chapter.id, { force })
      await afterMutation(chapter.id)
      toast.success(`已删除章节「${chapter.name}」`)
    }
    try {
      await remove(false)
    } catch (error) {
      if (!(error instanceof DeleteChapterImpactError)) {
        toast.error(error instanceof Error ? error.message : '删除章节失败，请稍后重试。')
        return
      }
      const { chapter_count, linked_palace_count, question_count } = error.impact
      const forced = await appConfirm(
        `这一章下面还有 ${chapter_count} 个章节、关联 ${linked_palace_count} 座宫殿、${question_count} 道题目。删除后题目一并删除且不可恢复。`,
        { title: '仍要删除章节', confirmText: '删除章节', tone: 'danger' },
      )
      if (!forced) return
      try {
        await remove(true)
      } catch (forceError) {
        toast.error(forceError instanceof Error ? forceError.message : '删除章节失败，请稍后重试。')
      }
    }
  }, [afterMutation])

  const chapterMenu = useCallback((
    chapter: ChapterMenuTarget,
    call: ChapterMenuCallOptions = {},
  ): RowMenuEntry[] => {
    const omit = new Set(call.omit ?? [])
    return buildChapterMenu({
      createPalace: omit.has('createPalace')
        ? undefined
        : { onSelect: () => void createPalaceIn(chapter.subjectId, chapter.id) },
      freestyle: omit.has('freestyle')
        ? undefined
        : { onSelect: () => navigate(`/freestyle?chapterId=${chapter.id}`) },
      rename: omit.has('rename')
        ? undefined
        : call.rename ?? { onSelect: () => void renameChapterWithPrompt(chapter) },
      remove: omit.has('remove')
        ? undefined
        : { onSelect: () => void removeChapter(chapter) },
    })
  }, [createPalaceIn, navigate, removeChapter, renameChapterWithPrompt])

  const renameSubjectTo = useCallback(async (subjectId: number, nextName: string) => {
    const name = nextName.trim()
    if (!name) return
    try {
      await updateSubjectApi(subjectId, { name })
      await afterMutation(subjectId)
      toast.success(`已改名为「${name}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '改名失败，请稍后重试。')
    }
  }, [afterMutation])

  const renameSubjectWithPrompt = useCallback(async (subject: SubjectMenuTarget) => {
    const next = await appPrompt('新的学科名', {
      title: '重命名学科',
      defaultValue: subject.name,
      confirmText: '保存',
    })
    if (next == null) return
    await renameSubjectTo(subject.id, next)
  }, [renameSubjectTo])

  const removeSubject = useCallback(async (subject: SubjectMenuTarget) => {
    const confirmed = await appConfirm(
      `删除学科「${subject.name}」？学科里的章节会一起删除。`,
      { title: '删除学科', confirmText: '删除学科', tone: 'danger' },
    )
    if (!confirmed) return
    try {
      await deleteSubjectApi(subject.id)
      await afterMutation(subject.id)
      toast.success(`已删除学科「${subject.name}」`)
    } catch (error) {
      if (error instanceof DeleteSubjectImpactError) {
        toast.warning(
          `该学科仍有 ${error.impact.chapter_count} 个章节、${error.impact.palace_count} 座宫殿，先把宫殿移走或删掉章节再删学科。`,
        )
        return
      }
      toast.error(error instanceof Error ? error.message : '删除学科失败，请稍后重试。')
    }
  }, [afterMutation])

  const subjectMenu = useCallback((
    subject: SubjectMenuTarget,
    call: SubjectMenuCallOptions = {},
  ): RowMenuEntry[] => {
    const omit = new Set(call.omit ?? [])
    return buildSubjectMenu({
      openShelf: omit.has('openShelf')
        ? undefined
        : { onSelect: () => navigate(`/palaces/list?subjectId=${subject.id}`) },
      openKnowledge: omit.has('openKnowledge')
        ? undefined
        : { onSelect: () => navigate(`/knowledge?subjectId=${subject.id}`) },
      createPalace: omit.has('createPalace')
        ? undefined
        : { onSelect: () => void createPalaceIn(subject.id, null) },
      rename: omit.has('rename')
        ? undefined
        : call.rename ?? { onSelect: () => void renameSubjectWithPrompt(subject) },
      remove: omit.has('remove')
        ? undefined
        : { onSelect: () => void removeSubject(subject) },
    })
  }, [createPalaceIn, navigate, removeSubject, renameSubjectWithPrompt])

  const moveDialog: ReactNode = useMemo(() => (
    <MovePalaceDialog
      open={moveTarget != null}
      palaceTitle={moveTarget?.title ?? ''}
      currentChapterId={moveTarget?.currentChapterId ?? null}
      onOpenChange={(open) => { if (!open) setMoveTarget(null) }}
      onPick={(target) => (moveTarget ? applyMove(moveTarget.id, target) : Promise.resolve())}
    />
  ), [applyMove, moveTarget])

  return {
    palaceMenu,
    chapterMenu,
    subjectMenu,
    moveDialog,
    renamePalaceTo,
    renameChapterTo,
    renameSubjectTo,
    createPalaceIn,
  }
}
