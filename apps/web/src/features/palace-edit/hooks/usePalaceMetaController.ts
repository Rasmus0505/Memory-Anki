import { useEffect, useState, type ChangeEvent } from 'react'
import { toast } from '@/shared/feedback/toast'
import { getSubjectTreeApi, getSubjectsApi } from '@/shared/api/modules/knowledge'
import {
  deleteAttachmentApi,
  linkPalaceChaptersApi,
  updatePalaceApi,
  uploadAttachmentApi,
} from '@/shared/api/modules/palaces'
import { formatDateTimeInputValue, toLocalDateTimePayload } from '@/features/palace-edit/model/palace-edit-format'
import type { ChapterOption, PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'

interface PalaceMetaControllerOptions {
  palace: PalaceMeta | null
  reload: () => Promise<void>
  timer: {
    registerActivity: (kind: string, meta?: Record<string, unknown>) => void
  }
}

export function usePalaceMetaController({
  palace,
  reload,
  timer,
}: PalaceMetaControllerOptions) {
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([])
  const [explicitChapterIds, setExplicitChapterIds] = useState<number[]>([])
  const [inheritedChapterIds, setInheritedChapterIds] = useState<number[]>([])
  const [primaryChapterId, setPrimaryChapterId] = useState<number | null>(null)
  const [chapterSelectionPending, setChapterSelectionPending] = useState(false)

  useEffect(() => {
    if (!palace) return
    setTitle(palace.title)
    setCreatedAt(formatDateTimeInputValue(palace.created_at))
    setExplicitChapterIds(
      palace.chapters.filter((chapter) => chapter.is_explicit !== false).map((chapter) => chapter.id),
    )
    setInheritedChapterIds(
      palace.chapters.filter((chapter) => chapter.is_explicit === false).map((chapter) => chapter.id),
    )
    setPrimaryChapterId(palace.primary_chapter_id ?? null)
  }, [palace])

  useEffect(() => {
    let cancelled = false

    const loadChapterOptions = async () => {
      const subjects = await getSubjectsApi()
      const trees = await Promise.all(subjects.map((subject) => getSubjectTreeApi(subject.id)))
      const toNode = (node: any, depth: number, subjectName: string): ChapterOption => ({
        id: node.id,
        name: node.name,
        depth,
        subjectId: node.subject_id ?? null,
        subjectName,
        parentId: node.parent_id ?? null,
        children: Array.isArray(node.children)
          ? node.children.map((child: any) => toNode(child, depth + 1, subjectName))
          : [],
      })

      if (cancelled) return
      setChapterOptions(
        trees.flatMap((tree) =>
          (tree.chapters || []).map((node: any) => toNode(node, 0, tree.subject?.name || '未命名学科')),
        ),
      )
    }

    void loadChapterOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const handleTitleChange = (value: string) => {
    timer.registerActivity('edit_operation', { source: 'title_input' })
    setTitle(value)
  }

  const handleCreatedAtChange = (value: string) => {
    timer.registerActivity('edit_operation', { source: 'created_at_input' })
    setCreatedAt(value)
  }

  const handleSaveMeta = async () => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'save_meta' })
    await updatePalaceApi(palace.id, {
      title: title.trim() || '未命名宫殿',
      created_at: createdAt ? toLocalDateTimePayload(createdAt) : null,
    })
    await reload()
  }

  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'establish_created_at' })
    await updatePalaceApi(palace.id, {
      created_at: new Date().toISOString(),
    })
    await reload()
  }

  const handleAttachmentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    timer.registerActivity('edit_operation', { source: 'attachment_upload' })
    await uploadAttachmentApi(palace.id, file)
    await reload()
    event.target.value = ''
  }

  const handleAttachmentDelete = async (attachmentId: number) => {
    timer.registerActivity('edit_operation', { source: 'attachment_delete' })
    await deleteAttachmentApi(attachmentId)
    await reload()
  }

  const handleChapterToggle = async (chapterId: number) => {
    if (!palace || chapterSelectionPending) return
    timer.registerActivity('edit_operation', { source: 'chapter_toggle' })
    const wasSelected = explicitChapterIds.includes(chapterId)
    const nextIds = wasSelected
      ? explicitChapterIds.filter((item) => item !== chapterId)
      : [...explicitChapterIds, chapterId]
    const nextPrimaryChapterId = wasSelected
      ? (primaryChapterId === chapterId ? null : primaryChapterId)
      : chapterId
    const previousExplicitChapterIds = explicitChapterIds
    const previousPrimaryChapterId = primaryChapterId
    setExplicitChapterIds(nextIds)
    setPrimaryChapterId(nextPrimaryChapterId)
    setChapterSelectionPending(true)
    try {
      await linkPalaceChaptersApi(palace.id, {
        chapter_ids: nextIds,
        primary_chapter_id: nextPrimaryChapterId,
      })
      await reload()
    } catch (nextError) {
      setExplicitChapterIds(previousExplicitChapterIds)
      setPrimaryChapterId(previousPrimaryChapterId)
      toast.error(nextError instanceof Error ? nextError.message : '章节关联保存失败，请稍后重试。')
    } finally {
      setChapterSelectionPending(false)
    }
  }

  return {
    title,
    setTitle: handleTitleChange,
    createdAt,
    setCreatedAt: handleCreatedAtChange,
    chapterOptions,
    explicitChapterIds,
    inheritedChapterIds,
    primaryChapterId,
    chapterSelectionPending,
    handleSaveMeta,
    handleEstablishCreatedAt,
    handleAttachmentUpload,
    handleAttachmentDelete,
    handleChapterToggle,
  }
}
