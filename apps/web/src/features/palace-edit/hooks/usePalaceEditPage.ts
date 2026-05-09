import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  createPalaceApi,
  deleteAttachmentApi,
  getPalaceEditorApi,
  getPalaceVersionDetailApi,
  getPalaceVersionsApi,
  linkPalaceChaptersApi,
  restorePalaceVersionApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
  updatePalaceApi,
  uploadAttachmentApi,
} from '@/shared/api/modules/palaces'
import { getSubjectsApi, getSubjectTreeApi } from '@/shared/api/modules/knowledge'
import type {
  PalaceVersionDetail,
  PalaceVersionSummary,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import {
  formatDateTimeInputValue,
  toLocalDateTimePayload,
} from '@/features/palace-edit/model/palace-edit-format'

export interface PalaceMeta {
  id: number
  title: string
  description: string
  created_at: string | null
  attachments: Array<{ id: number; original_name: string; file_size: number }>
  chapters: Array<{
    id: number
    name: string
    subject?: { id: number; name: string } | null
  }>
}

export interface ChapterOption {
  id: number
  label: string
}

type StatusBadgeState = {
  variant: 'secondary' | 'destructive'
  label: string
}

export function usePalaceEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const palaceId = id ? Number(id) : null
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [frameVersion, setFrameVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([])
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const [versionOpen, setVersionOpen] = useState(false)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [versions, setVersions] = useState<PalaceVersionSummary[]>([])
  const [removedDuplicateCount, setRemovedDuplicateCount] = useState(0)
  const [previewingVersionId, setPreviewingVersionId] = useState<number | null>(
    null,
  )
  const [previewVersionDetail, setPreviewVersionDetail] =
    useState<PalaceVersionDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const {
    meta,
    editorState,
    setEditorState,
    isSaving,
    error,
    reload,
  } = usePersistedMindMapEditor({
    entityId: palaceId,
    fetcher: getPalaceEditorApi,
    saver: savePalaceEditorApi,
    selectMeta: (response) => response.palace as PalaceMeta,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
    }),
    onSaveError: async (nextError, pendingState) => {
      if (!palaceId || !nextError.message.includes('危险结构变更')) return false
      const confirmed = window.confirm(
        '这次保存会让宫殿节点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      )
      if (!confirmed) return true
      await savePalaceEditorWithOptionsApi(palaceId, {
        ...pendingState,
        confirm_dangerous_change: true,
        editor_source: 'palace_edit',
      })
      await reload()
      setFrameVersion((value) => value + 1)
      return true
    },
  })

  const palace = meta as PalaceMeta | null
  const selectedNode = selectedNodes[0] ?? null
  const timer = useTimedSession({
    kind: 'palace_edit',
    title: title || palace?.title || '未命名宫殿',
    palaceId,
  })
  const timerRef = useRef(timer)

  useEffect(() => {
    if (!palaceId || !editorState) return
    if (timer.status !== 'idle') return
    timer.start({ source: 'page_enter' })
  }, [editorState, palaceId, timer])

  useEffect(() => {
    timerRef.current = timer
  }, [timer, timerRef])

  useEffect(() => {
    return () => {
      const currentTimer = timerRef.current
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.complete('left_page')
      }
    }
  }, [timerRef])

  useEffect(() => {
    if (!mindMapFullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mindMapFullscreen])

  useEffect(() => {
    if (palaceId || isCreatingDraft) return
    setIsCreatingDraft(true)
    void createPalaceApi({ title: '未命名宫殿', description: '', pegs: [] }).then(
      (created) => {
        navigate(`/palaces/${created.id}/edit`, { replace: true })
      },
    )
  }, [isCreatingDraft, navigate, palaceId])

  useEffect(() => {
    if (!palace) return
    setTitle(palace.title)
    setCreatedAt(formatDateTimeInputValue(palace.created_at))
    setSelectedChapterIds(palace.chapters.map((chapter) => chapter.id))
  }, [palace])

  const handleTitleChange = (value: string) => {
    timer.registerActivity({ source: 'title_input' })
    setTitle(value)
  }

  const handleCreatedAtChange = (value: string) => {
    timer.registerActivity({ source: 'created_at_input' })
    setCreatedAt(value)
  }

  useEffect(() => {
    const loadChapterOptions = async () => {
      const subjects = await getSubjectsApi()
      const trees = await Promise.all(
        subjects.map((subject) => getSubjectTreeApi(subject.id)),
      )
      const options: ChapterOption[] = []

      const walk = (nodes: any[], depth: number, subjectName: string) => {
        for (const node of nodes) {
          options.push({
            id: node.id,
            label: `${subjectName} / ${'· '.repeat(depth)}${node.name}`,
          })
          walk(node.children || [], depth + 1, subjectName)
        }
      }

      trees.forEach((tree) => {
        walk(tree.chapters || [], 0, tree.subject?.name || '未命名学科')
      })
      setChapterOptions(options)
    }

    void loadChapterOptions()
  }, [])

  const handleSaveMeta = async () => {
    if (!palace) return
    timer.registerActivity({ source: 'save_meta' })
    await updatePalaceApi(palace.id, {
      title: title.trim() || '未命名宫殿',
      created_at: createdAt ? toLocalDateTimePayload(createdAt) : null,
    })
    await reload()
    setFrameVersion((value) => value + 1)
  }

  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    timer.registerActivity({ source: 'establish_created_at' })
    await updatePalaceApi(palace.id, {
      created_at: new Date().toISOString(),
    })
    await reload()
  }

  const handleAttachmentUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    timer.registerActivity({ source: 'attachment_upload' })
    await uploadAttachmentApi(palace.id, file)
    await reload()
    event.target.value = ''
  }

  const handleAttachmentDelete = async (attachmentId: number) => {
    timer.registerActivity({ source: 'attachment_delete' })
    await deleteAttachmentApi(attachmentId)
    await reload()
  }

  const handleChapterToggle = async (chapterId: number) => {
    if (!palace) return
    timer.registerActivity({ source: 'chapter_toggle' })
    const nextIds = selectedChapterIds.includes(chapterId)
      ? selectedChapterIds.filter((item) => item !== chapterId)
      : [...selectedChapterIds, chapterId]
    setSelectedChapterIds(nextIds)
    await linkPalaceChaptersApi(palace.id, nextIds)
    await reload()
  }

  const handleOpenVersions = async () => {
    if (!palace) return
    const result = await getPalaceVersionsApi(palace.id)
    setVersions(result.versions)
    setRemovedDuplicateCount(result.removed_duplicates ?? 0)
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
    setVersionOpen(true)
  }

  const handlePreviewVersion = async (versionId: number) => {
    if (!palace) return
    setPreviewingVersionId(versionId)
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const detail = await getPalaceVersionDetailApi(palace.id, versionId)
      setPreviewVersionDetail(detail)
    } catch (err) {
      setPreviewVersionDetail(null)
      setPreviewError(err instanceof Error ? err.message : '加载版本预览失败。')
    } finally {
      setPreviewLoading(false)
    }
  }

  const resetVersionPreview = () => {
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
  }

  const handleCloseVersions = () => {
    setVersionOpen(false)
    resetVersionPreview()
    setRemovedDuplicateCount(0)
  }

  const handleRestoreVersion = async (versionId: number) => {
    if (!palace) return
    const confirmed = window.confirm(
      '恢复历史版本只会回滚当前宫殿内容，不会影响其他宫殿和复习记录。确定继续吗？',
    )
    if (!confirmed) return
    await restorePalaceVersionApi(palace.id, versionId)
    await reload()
    setFrameVersion((value) => value + 1)
    handleCloseVersions()
  }

  const statusBadge = useMemo<StatusBadgeState>(() => {
    if (!palaceId) {
      return { variant: 'secondary', label: '正在创建草稿' }
    }
    if (error) {
      return { variant: 'destructive', label: '保存异常' }
    }
    if (!editorState) {
      return { variant: 'secondary', label: '加载中' }
    }
    if (isSaving) {
      return { variant: 'secondary', label: '自动保存脑图中' }
    }
    return { variant: 'secondary', label: '宿主桥已连接' }
  }, [editorState, error, isSaving, palaceId])

  return {
    palaceId,
    palace,
    timer,
    title,
    setTitle: handleTitleChange,
    createdAt,
    setCreatedAt: handleCreatedAtChange,
    chapterOptions,
    selectedChapterIds,
    versionOpen,
    setVersionOpen,
    mindMapFullscreen,
    setMindMapFullscreen,
    versions,
    removedDuplicateCount,
    previewingVersionId,
    previewVersionDetail,
    previewLoading,
    previewError,
    editorState,
    frameVersion,
    selectedNode,
    setSelectedNodes,
    setEditorState,
    handleSaveMeta,
    handleEstablishCreatedAt,
    handleAttachmentUpload,
    handleAttachmentDelete,
    handleChapterToggle,
    handleOpenVersions,
    handlePreviewVersion,
    handleCloseVersions,
    handleRestoreVersion,
    resetVersionPreview,
    statusBadge,
  }
}
