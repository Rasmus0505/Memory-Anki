import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { toast } from '@/shared/feedback/toast'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  getSubjectTreeApi,
  getSubjectsApi,
} from '@/modules/content/public'
import {
  buildChapterSummary,
  collectAllowedChapterIds,
  resolveChapterInfoFromTrees,
  type PalaceQuizPageMeta,
  type QuizGenerationSourceKind,
  type SubjectTreePayload,
} from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'

interface UsePalaceQuizGenerationInputsOptions {
  palace: PalaceQuizPageMeta | null
  generationLoading: boolean
  generationStreamPreviewText: string
  registerQuizActivity: (source: string) => void
  emitQuizFeedback: (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => void
  setGenerationError: Dispatch<SetStateAction<string>>
}

export interface PalaceQuizGenerationInputs {
  generationSourceKind: QuizGenerationSourceKind
  setGenerationSourceKind: Dispatch<SetStateAction<QuizGenerationSourceKind>>
  generationFiles: File[]
  setGenerationFiles: Dispatch<SetStateAction<File[]>>
  extraPrompt: string
  setExtraPrompt: Dispatch<SetStateAction<string>>
  subjectsLoading: boolean
  rangeDialogOpen: boolean
  setRangeDialogOpen: Dispatch<SetStateAction<boolean>>
  chapterTrees: SubjectTreePayload[]
  chapterTreesLoading: boolean
  selectedChapterId: number | null
  setSelectedChapterId: Dispatch<SetStateAction<number | null>>
  selectedChapterSummary: string
  pendingChapterId: number | null
  pendingChapterSummary: string
  allowedChapterIds: Set<number>
  selectedChapterHasChildren: boolean
  generationStreamContentRef: RefObject<HTMLPreElement | null>
  miniPalaces: NonNullable<PalaceQuizPageMeta['segments']>
  handleOpenRangeDialog: () => Promise<void>
  handleConfirmRangeSelection: () => void
  setPendingChapterId: Dispatch<SetStateAction<number | null>>
  handleImageFileChange: (fileList: FileList | null) => void
  handleGenerationStreamScroll: () => void
  resetGenerationStreamFollow: () => void
  getChapterHasChildren: (chapterId: number | null) => boolean
}

export function usePalaceQuizGenerationInputs({
  palace,
  generationLoading,
  generationStreamPreviewText,
  registerQuizActivity,
  emitQuizFeedback,
  setGenerationError,
}: UsePalaceQuizGenerationInputsOptions): PalaceQuizGenerationInputs {
  const [generationSourceKind, setGenerationSourceKind] =
    useState<QuizGenerationSourceKind>('image-single')
  const [generationFiles, setGenerationFiles] = useState<File[]>([])
  const [extraPrompt, setExtraPrompt] = useState('')
  const [subjects, setSubjects] = useState<Array<{ id: number; name: string }>>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [rangeDialogOpen, setRangeDialogOpen] = useState(false)
  const [chapterTrees, setChapterTrees] = useState<SubjectTreePayload[]>([])
  const [chapterTreesLoading, setChapterTreesLoading] = useState(false)
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)
  const [pendingChapterId, setPendingChapterId] = useState<number | null>(null)
  const generationStreamContentRef = useRef<HTMLPreElement | null>(null)
  const generationStreamAutoFollowRef = useRef(true)

  const miniPalaces = palace?.segments || []
  const explicitPalaceChapterIds = useMemo(
    () =>
      new Set(
        (palace?.chapters || [])
          .filter((chapter) => chapter.is_explicit !== false)
          .map((chapter) => chapter.id),
      ),
    [palace],
  )
  const allowedChapterIds = useMemo(() => {
    if (explicitPalaceChapterIds.size === 0) return new Set<number>()
    const collector = new Set<number>()
    chapterTrees.forEach((tree) => {
      collectAllowedChapterIds(tree.chapters || [], explicitPalaceChapterIds, false, collector)
    })
    return collector
  }, [chapterTrees, explicitPalaceChapterIds])
  const selectedChapterInfo = useMemo(() => {
    const resolved = resolveChapterInfoFromTrees(chapterTrees, selectedChapterId)
    if (resolved) return resolved
    if (!selectedChapterId) return null
    const fallbackChapter =
      palace?.primary_chapter_id === selectedChapterId
        ? palace.primary_chapter
        : (palace?.chapters || []).find((chapter) => chapter.id === selectedChapterId)
    if (!fallbackChapter?.name) return null
    return {
      subjectName:
        ('subject' in fallbackChapter ? fallbackChapter.subject?.name : undefined) ||
        subjects.find((subject) => subject.id === fallbackChapter.subject_id)?.name ||
        '未命名学科',
      path: [
        {
          id: fallbackChapter.id,
          name: fallbackChapter.name,
          subject_id: fallbackChapter.subject_id,
          parent_id: fallbackChapter.parent_id,
          children: [],
        },
      ],
    }
  }, [chapterTrees, palace, selectedChapterId, subjects])
  const pendingChapterInfo = useMemo(
    () => resolveChapterInfoFromTrees(chapterTrees, pendingChapterId),
    [chapterTrees, pendingChapterId],
  )
  const selectedChapterSummary = buildChapterSummary(selectedChapterInfo)
  const pendingChapterSummary = buildChapterSummary(pendingChapterInfo)
  const selectedChapterHasChildren = Boolean(
    selectedChapterInfo?.path[selectedChapterInfo.path.length - 1]?.children?.length,
  )

  const getChapterHasChildren = useCallback(
    (chapterId: number | null) => {
      if (!chapterId) return false
      const info = resolveChapterInfoFromTrees(chapterTrees, chapterId)
      return Boolean(info?.path[info.path.length - 1]?.children?.length)
    },
    [chapterTrees],
  )

  useEffect(() => {
    let cancelled = false
    const loadSubjects = async () => {
      setSubjectsLoading(true)
      try {
        const result = await getSubjectsApi()
        if (cancelled) return
        setSubjects((result || []).map((item) => ({ id: item.id, name: item.name })))
      } catch {
        if (!cancelled) setSubjects([])
      } finally {
        if (!cancelled) setSubjectsLoading(false)
      }
    }
    void loadSubjects()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!palace) return
    setSelectedChapterId(palace.primary_chapter_id ?? null)
  }, [palace])

  const ensureChapterTreesLoaded = useCallback(async () => {
    if (chapterTrees.length > 0 || chapterTreesLoading) return
    const subjectIds = Array.from(
      new Set(
        (palace?.chapters || [])
          .map((chapter) => chapter.subject?.id ?? chapter.subject_id ?? null)
          .filter((value): value is number => typeof value === 'number'),
      ),
    )
    if (subjectIds.length === 0) return
    setChapterTreesLoading(true)
    try {
      const trees = await Promise.all(subjectIds.map((subjectId) => getSubjectTreeApi(subjectId)))
      setChapterTrees(trees as SubjectTreePayload[])
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '加载章节范围失败。')
    } finally {
      setChapterTreesLoading(false)
    }
  }, [chapterTrees.length, chapterTreesLoading, palace])

  useEffect(() => {
    if (!palace?.chapters?.length || chapterTrees.length > 0 || chapterTreesLoading) return
    void ensureChapterTreesLoaded()
  }, [chapterTrees.length, chapterTreesLoading, ensureChapterTreesLoaded, palace])

  useEffect(() => {
    if (!generationLoading || !generationStreamPreviewText) return
    const content = generationStreamContentRef.current
    if (content && generationStreamAutoFollowRef.current) {
      content.scrollTop = content.scrollHeight
    }
  }, [generationLoading, generationStreamPreviewText])

  const handleOpenRangeDialog = useCallback(async () => {
    registerQuizActivity('generation_open_range_dialog')
    setPendingChapterId(selectedChapterId)
    await ensureChapterTreesLoaded()
    setRangeDialogOpen(true)
  }, [ensureChapterTreesLoaded, registerQuizActivity, selectedChapterId])

  const handleConfirmRangeSelection = useCallback(() => {
    if (!pendingChapterId) {
      toast.error('请先选择一个章节范围。')
      return
    }
    setSelectedChapterId(pendingChapterId)
    setRangeDialogOpen(false)
  }, [pendingChapterId])

  const handleImageFileChange = useCallback(
    (fileList: FileList | null) => {
      registerQuizActivity('generation_select_files')
      emitQuizFeedback('quiz_generate_attach_source', { label: '选文件', audioScope: 'local' })
      const nextFiles = Array.from(fileList || [])
      setGenerationFiles(
        generationSourceKind === 'image-single' ? nextFiles.slice(0, 1) : nextFiles,
      )
      setGenerationError('')
    },
    [emitQuizFeedback, generationSourceKind, registerQuizActivity, setGenerationError],
  )

  const handleGenerationStreamScroll = useCallback(() => {
    const content = generationStreamContentRef.current
    if (!content) return
    const remaining = content.scrollHeight - content.scrollTop - content.clientHeight
    generationStreamAutoFollowRef.current = remaining <= 32
  }, [])

  const resetGenerationStreamFollow = useCallback(() => {
    generationStreamAutoFollowRef.current = true
  }, [])

  return {
    generationSourceKind,
    setGenerationSourceKind,
    generationFiles,
    setGenerationFiles,
    extraPrompt,
    setExtraPrompt,
    subjectsLoading,
    rangeDialogOpen,
    setRangeDialogOpen,
    chapterTrees,
    chapterTreesLoading,
    selectedChapterId,
    setSelectedChapterId,
    selectedChapterSummary,
    pendingChapterId,
    pendingChapterSummary,
    allowedChapterIds,
    selectedChapterHasChildren,
    generationStreamContentRef,
    miniPalaces,
    handleOpenRangeDialog,
    handleConfirmRangeSelection,
    setPendingChapterId,
    handleImageFileChange,
    handleGenerationStreamScroll,
    resetGenerationStreamFollow,
    getChapterHasChildren,
  }
}
