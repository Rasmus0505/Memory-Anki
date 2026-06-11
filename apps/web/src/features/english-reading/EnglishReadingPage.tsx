import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenText,
  ExternalLink,
  FileText,
  LoaderCircle,
  PencilLine,
  RefreshCcw,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { Children } from 'react'
import { createElement } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type {
  CefrLevel,
  ReadingCompletionResponse,
  ReadingDifficultyDelta,
  ReadingDifficultyDirection,
  ReadingGenerateRequest,
  ReadingMaterial,
  ReadingProfile,
  ReadingRenderSentence,
  ReadingSessionResult,
  ReadingVersion,
  ReadingWorkspaceStats,
  SentenceAnnotation,
  SpanAnnotation,
} from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import {
  completeEnglishReadingMaterialApi,
  createEnglishReadingMaterialApi,
  deleteEnglishReadingMaterialApi,
  generateEnglishReadingVersionApi,
  getEnglishReadingMaterialApi,
  getEnglishReadingWorkspaceApi,
  getEnglishReadingVersionApi,
  updateEnglishReadingMaterialApi,
  updateEnglishReadingProfileApi,
} from '@/features/english-reading/api/englishReadingApi'

const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const GENERATION_STAGES = [
  '正在清理段落结构……',
  '正在比对本地词典……',
  '正在补全未识别词形……',
  '正在计算你的 i+1 预算……',
  '正在重构长难句……',
  '正在编排沉浸式阅读稿……',
]
const READING_FILE_ACCEPT = '.txt,.md,.pdf,text/plain,text/markdown,application/pdf'
const READING_FILE_SUFFIXES = ['.txt', '.md', '.pdf'] as const
const READING_DIFFICULTY_OPTIONS: ReadonlyArray<ReadingDifficultyDelta> = [0.5, 1, 1.5, 2]

type GenerationRequest =
  | { kind: 'initial' }
  | {
      kind: 'regenerate'
      direction: ReadingDifficultyDirection
      delta: ReadingDifficultyDelta
    }

function clampLevelIndex(index: number) {
  return Math.min(CEFR_LEVELS.length - 1, Math.max(0, index))
}

function formatWorkingBand(value: number) {
  const base = Math.floor(value)
  const safeBase = clampLevelIndex(base)
  const level = CEFR_LEVELS[safeBase]
  const offset = value - safeBase
  if (offset >= 0.66 && safeBase < CEFR_LEVELS.length - 1) {
    return `${level}+`
  }
  if (offset <= 0.2) {
    return level
  }
  return `${level} 中段`
}

function formatMinutes(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  if (minutes <= 0) return `${remainSeconds} 秒`
  return `${minutes} 分 ${remainSeconds} 秒`
}

function formatDifficultyDelta(value: ReadingDifficultyDelta) {
  return value % 1 === 0 ? `${value.toFixed(1)} 级` : `${value} 级`
}

function getGenerationSuccessMessage(request: GenerationRequest) {
  if (request.kind === 'initial') {
    return 'i+1 阅读材料已生成。'
  }
  if (request.direction === 'easier') {
    return '已按更简单的难度重新生成。'
  }
  if (request.direction === 'harder') {
    return '已按更高的难度重新生成。'
  }
  return '已重新生成当前内容。'
}

function summarizeFeedback(feedback: ReadingSessionResult['feedback']) {
  if (feedback === 'too_easy') return '太简单'
  if (feedback === 'too_hard') return '有点难'
  return '刚刚好'
}

function isSupportedReadingFile(file: File) {
  const normalizedName = file.name.trim().toLowerCase()
  return READING_FILE_SUFFIXES.some((suffix) => normalizedName.endsWith(suffix))
}

function AnnotationMark({
  text,
  annotation,
  onHover,
}: {
  text: string
  annotation: SpanAnnotation
  onHover: (annotationId: string) => void
}) {
  const palette =
    annotation.kind === 'green'
      ? 'text-emerald-700 bg-emerald-100/80 ring-emerald-200'
      : annotation.kind === 'yellow'
        ? 'text-amber-800 bg-amber-100/90 ring-amber-200'
        : 'text-rose-700 bg-rose-100/90 ring-rose-200'
  return (
    <span
      className={cn(
        'group relative inline rounded-md px-1 py-0.5 ring-1 ring-inset transition-colors',
        palette,
      )}
      onMouseEnter={() => onHover(annotation.id)}
    >
      {text}
      <span className="invisible absolute bottom-[calc(100%+10px)] left-1/2 z-20 w-72 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white/98 p-3 text-left text-xs text-slate-700 opacity-0 shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-all group-hover:visible group-hover:opacity-100">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {annotation.kind === 'green'
            ? '原文 i+1'
            : annotation.kind === 'yellow'
              ? '升级表达'
              : '降阶救援'}
        </span>
        <span className="mt-2 block font-medium text-slate-900">
          原文：{annotation.originalText || annotation.displayText}
        </span>
        {annotation.sourceCefr ? (
          <span className="mt-1 block text-slate-500">
            CEFR：{annotation.sourceCefr}
            {annotation.targetCefr && annotation.targetCefr !== annotation.sourceCefr
              ? ` → ${annotation.targetCefr}`
              : ''}
          </span>
        ) : null}
        {annotation.explainZh ? <span className="mt-2 block">{annotation.explainZh}</span> : null}
      </span>
    </span>
  )
}

function SentenceLine({
  sentence,
  sentenceAnnotation,
  annotationMap,
  expanded,
  onHoverAnnotation,
  onToggleExpanded,
}: {
  sentence: ReadingRenderSentence
  sentenceAnnotation: SentenceAnnotation | undefined
  annotationMap: Map<string, SpanAnnotation>
  expanded: boolean
  onHoverAnnotation: (annotationId: string) => void
  onToggleExpanded: () => void
}) {
  const content = sentence.parts.map((part, index) => {
    if (part.spanAnnotationId) {
      const annotation = annotationMap.get(part.spanAnnotationId)
      if (annotation) {
        return (
          <AnnotationMark
            key={annotation.id}
            text={part.text}
            annotation={annotation}
            onHover={onHoverAnnotation}
          />
        )
      }
    }
    return <span key={sentence.id + '-part-' + index}>{part.text}</span>
  })
  const isSimplified = sentenceAnnotation?.kind === 'syntax_simplified'

  if (!isSimplified || !sentenceAnnotation) {
    return <span className="mr-1">{content}</span>
  }

  return (
    <span className="mb-3 inline-block align-top">
      <button
        type="button"
        className="rounded-xl bg-rose-50/90 px-2 py-1 text-left leading-9 text-rose-950 transition hover:bg-rose-100"
        onClick={onToggleExpanded}
      >
        {content}
      </button>
      {expanded ? (
        <span className="mt-2 block rounded-2xl border border-rose-200/80 bg-white/95 p-4 text-sm leading-7 text-slate-700 shadow-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">
            原句骨架
          </span>
          <span className="mt-2 block text-[15px] text-slate-900">{sentenceAnnotation.originalText}</span>
          {sentenceAnnotation.skeletonHints.length > 0 ? (
            <span className="mt-3 flex flex-wrap gap-2">
              {sentenceAnnotation.skeletonHints.map((hint) => (
                <span
                  key={sentence.id + '-hint-' + hint}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
                >
                  {hint}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

export default function EnglishReadingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentMaterialId = Number(searchParams.get('material') || '')
  const resolvedMaterialId = Number.isFinite(currentMaterialId) && currentMaterialId > 0 ? currentMaterialId : null

  const [profile, setProfile] = useState<ReadingProfile | null>(null)
  const [workspaceStats, setWorkspaceStats] = useState<ReadingWorkspaceStats | null>(null)
  const [recentMaterials, setRecentMaterials] = useState<ReadingMaterial[]>([])
  const [material, setMaterial] = useState<ReadingMaterial | null>(null)
  const [version, setVersion] = useState<ReadingVersion | null>(null)
  const [textInput, setTextInput] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [sourceMode, setSourceMode] = useState<'text' | 'file'>('text')
  const [dropzoneActive, setDropzoneActive] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [versionLoading, setVersionLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState<CefrLevel | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationStageIndex, setGenerationStageIndex] = useState(0)
  const [completionPanelOpen, setCompletionPanelOpen] = useState(false)
  const [completionSubmitting, setCompletionSubmitting] = useState<ReadingSessionResult['feedback'] | null>(null)
  const [completionResponse, setCompletionResponse] = useState<ReadingCompletionResponse | null>(null)
  const [hoveredAnnotationIds, setHoveredAnnotationIds] = useState<Set<string>>(() => new Set())
  const [expandedSentenceIds, setExpandedSentenceIds] = useState<Set<string>>(() => new Set())
  const [automationOpen, setAutomationOpen] = useState(false)
  const [automationConfig, setAutomationConfig] = useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [openingMaterialId, setOpeningMaterialId] = useState<number | null>(null)
  const [renamingMaterialId, setRenamingMaterialId] = useState<number | null>(null)
  const [deletingMaterialId, setDeletingMaterialId] = useState<number | null>(null)
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false)
  const [regenerateDirection, setRegenerateDirection] = useState<ReadingDifficultyDirection>('same')
  const [regenerateDelta, setRegenerateDelta] = useState<ReadingDifficultyDelta>(0.5)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const generationTimerRef = useRef<number | null>(null)
  const readingPanelRef = useRef<HTMLDivElement | null>(null)

  const timer = useTimedSession({
    kind: 'practice',
    title: material ? `英语阅读 · ${material.title}` : '英语阅读',
    palaceId: null,
    automationScene: 'english_reading',
    sourceKind: 'english_reading',
    persistKey: material ? `english-reading:${material.id}` : null,
  })

  const annotationMap = useMemo(
    () => new Map((version?.spanAnnotations ?? []).map((item) => [item.id, item])),
    [version?.spanAnnotations],
  )
  const sentenceAnnotationMap = useMemo(
    () => new Map((version?.sentenceAnnotations ?? []).map((item) => [item.id, item])),
    [version?.sentenceAnnotations],
  )

  const loadWorkspace = useCallback(async () => {
    const nextWorkspace = await getEnglishReadingWorkspaceApi()
    setProfile(nextWorkspace.profile)
    setWorkspaceStats(nextWorkspace.stats)
    setRecentMaterials(nextWorkspace.recentMaterials)
  }, [])

  const loadMaterialAndVersion = useCallback(async (materialId: number) => {
    setVersionLoading(true)
    try {
      const nextMaterial = await getEnglishReadingMaterialApi(materialId)
      setMaterial(nextMaterial)
      try {
        const nextVersion = await getEnglishReadingVersionApi(materialId)
        setVersion(nextVersion)
      } catch (error) {
        const message = error instanceof Error ? error.message : '加载阅读版本失败。'
        if (!/还没有生成阅读版本/.test(message)) {
          toast.error(message)
        }
        setVersion(null)
      }
    } finally {
      setVersionLoading(false)
    }
  }, [])

  const scrollToReadingPanel = useCallback(() => {
    window.setTimeout(() => {
      if (typeof readingPanelRef.current?.scrollIntoView === 'function') {
        readingPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (cancelled) return
        await loadWorkspace()
        if (cancelled) return
        if (resolvedMaterialId) {
          await loadMaterialAndVersion(resolvedMaterialId)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '英语阅读加载失败。')
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadMaterialAndVersion, loadWorkspace, resolvedMaterialId])

  useEffect(() => {
    if (!generating) {
      if (generationTimerRef.current != null) {
        window.clearInterval(generationTimerRef.current)
        generationTimerRef.current = null
      }
      return
    }
    setGenerationStageIndex(0)
    generationTimerRef.current = window.setInterval(() => {
      setGenerationStageIndex((current) => Math.min(GENERATION_STAGES.length - 1, current + 1))
    }, 1200)
    return () => {
      if (generationTimerRef.current != null) {
        window.clearInterval(generationTimerRef.current)
        generationTimerRef.current = null
      }
    }
  }, [generating])

  useEffect(() => {
    if (!version?.id) return
    timer.reset()
    setHoveredAnnotationIds(new Set())
    setExpandedSentenceIds(new Set())
    setCompletionResponse(null)
    setCompletionPanelOpen(false)
  }, [timer.reset, version?.id])

  useEffect(() => {
    if (!version?.id) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'english_reading')) return
    timer.start({ source: 'english_reading_open' })
  }, [timer.start, timer.status, version?.id])

  const handleSelectLevel = useCallback(
    async (level: CefrLevel) => {
      setProfileSaving(level)
      try {
        const nextProfile = await updateEnglishReadingProfileApi({ declaredCefr: level })
        setProfile(nextProfile)
        setCompletionResponse(null)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '更新 CEFR 失败。')
      } finally {
        setProfileSaving(null)
      }
    },
    [],
  )

  const handleUseSelectedFile = useCallback((file: File | null) => {
    if (!file) return
    if (!isSupportedReadingFile(file)) {
      toast.error('目前只支持拖入或上传 txt / md / pdf 文件。')
      return
    }
    setSelectedFile(file)
    setSourceMode('file')
  }, [])

  const handleTextInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value
      setTextInput(nextValue)
      if (nextValue.trim()) {
        setSourceMode('text')
      } else if (!selectedFile) {
        setSourceMode('text')
      }
    },
    [selectedFile],
  )

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleUseSelectedFile(event.target.files?.[0] ?? null)
      event.target.value = ''
    },
    [handleUseSelectedFile],
  )

  const handleOpenFilePicker = useCallback(() => {
    if (generating) return
    fileInputRef.current?.click()
  }, [generating])

  const handleDropzoneKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      handleOpenFilePicker()
    },
    [handleOpenFilePicker],
  )

  const handleDropzoneDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (generating) return
      dragDepthRef.current += 1
      setDropzoneActive(true)
    },
    [generating],
  )

  const handleDropzoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (generating) return
      event.dataTransfer.dropEffect = 'copy'
      setDropzoneActive(true)
    },
    [generating],
  )

  const handleDropzoneDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (generating) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setDropzoneActive(false)
      }
    },
    [generating],
  )

  const handleDropzoneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      dragDepthRef.current = 0
      setDropzoneActive(false)
      if (generating) return
      handleUseSelectedFile(event.dataTransfer.files?.[0] ?? null)
    },
    [generating, handleUseSelectedFile],
  )

  const runGeneration = useCallback(
    async (request: GenerationRequest) => {
      setGenerating(true)
      try {
        let activeMaterial = material
        if (request.kind === 'initial') {
          const useFileInput = sourceMode === 'file' && selectedFile
          activeMaterial = await createEnglishReadingMaterialApi({
            text: useFileInput ? '' : textInput,
            file: useFileInput ? selectedFile : null,
          })
          setMaterial(activeMaterial)
          setSearchParams((current) => {
            const next = new URLSearchParams(current)
            next.set('material', String(activeMaterial.id))
            return next
          })
        }
        if (!activeMaterial) {
          throw new Error('当前没有可生成的阅读材料。')
        }
        const generationPayload: ReadingGenerateRequest =
          request.kind === 'initial'
            ? { mode: 'initial' }
            : request.direction === 'same'
              ? { mode: 'regenerate', difficultyDirection: 'same' }
              : {
                  mode: 'regenerate',
                  difficultyDirection: request.direction,
                  difficultyDelta: request.delta,
                }
        const nextVersion = await generateEnglishReadingVersionApi(activeMaterial.id, generationPayload)
        const nextMaterial = await getEnglishReadingMaterialApi(activeMaterial.id)
        setMaterial(nextMaterial)
        setVersion(nextVersion)
        setCompletionResponse(null)
        await loadWorkspace()
        if (request.kind === 'regenerate') {
          setRegenerateDialogOpen(false)
        }
        toast.success(getGenerationSuccessMessage(request))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '生成阅读材料失败。')
      } finally {
        setGenerating(false)
      }
    },
    [loadWorkspace, material, selectedFile, setSearchParams, sourceMode, textInput],
  )

  const handleCreateAndGenerate = useCallback(async () => {
    if (!textInput.trim() && !selectedFile) {
      toast.error('请先粘贴正文或选择 txt / md / pdf 文件。')
      return
    }
    await runGeneration({ kind: 'initial' })
  }, [runGeneration, selectedFile, textInput])

  const handleOpenRegenerateDialog = useCallback(() => {
    if (!material) return
    setRegenerateDirection('same')
    setRegenerateDelta(0.5)
    setRegenerateDialogOpen(true)
  }, [material])

  const handleConfirmRegenerate = useCallback(async () => {
    if (!material) return
    await runGeneration({
      kind: 'regenerate',
      direction: regenerateDirection,
      delta: regenerateDelta,
    })
  }, [material, regenerateDelta, regenerateDirection, runGeneration])

  const handleOpenRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (openingMaterialId === item.id) return
      setOpeningMaterialId(item.id)
      try {
        setSearchParams((current) => {
          const next = new URLSearchParams(current)
          next.set('material', String(item.id))
          return next
        })
        await loadMaterialAndVersion(item.id)
        scrollToReadingPanel()
        if (!item.latestVersionId) {
          toast.success('这篇材料已打开，还没有阅读稿，你可以继续生成。')
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '打开阅读材料失败。')
      } finally {
        setOpeningMaterialId(null)
      }
    },
    [loadMaterialAndVersion, openingMaterialId, scrollToReadingPanel, setSearchParams],
  )

  const handleRenameRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (renamingMaterialId || deletingMaterialId) return
      const nextTitle = window.prompt('Edit title', item.title)?.trim()
      if (!nextTitle || nextTitle === item.title) return
      setRenamingMaterialId(item.id)
      try {
        const updated = await updateEnglishReadingMaterialApi(item.id, { title: nextTitle })
        setRecentMaterials((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        )
        setMaterial((current) => (current?.id === updated.id ? updated : current))
        toast.success('阅读材料标题已更新。')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '重命名阅读材料失败。')
      } finally {
        setRenamingMaterialId(null)
      }
    },
    [deletingMaterialId, renamingMaterialId],
  )

  const handleDeleteRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (deletingMaterialId || renamingMaterialId) return
      const confirmed = window.confirm(`Delete "${item.title}" from reading history?`)
      if (!confirmed) return
      setDeletingMaterialId(item.id)
      try {
        await deleteEnglishReadingMaterialApi(item.id)
        setRecentMaterials((current) => current.filter((entry) => entry.id !== item.id))
        setWorkspaceStats((current) =>
          current
            ? {
                ...current,
                totalMaterials: Math.max(0, current.totalMaterials - 1),
                generatedMaterials:
                  item.latestVersionId == null
                    ? current.generatedMaterials
                    : Math.max(0, current.generatedMaterials - 1),
              }
            : current,
        )
        if (material?.id === item.id) {
          setMaterial(null)
          setVersion(null)
          setCompletionResponse(null)
          setCompletionPanelOpen(false)
          timer.reset()
          setSearchParams((current) => {
            const next = new URLSearchParams(current)
            next.delete('material')
            return next
          })
        }
        toast.success('阅读历史已删除。')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '删除阅读历史失败。')
      } finally {
        setDeletingMaterialId(null)
      }
    },
    [deletingMaterialId, material?.id, renamingMaterialId, setSearchParams, timer],
  )

  const handleAnnotationHover = useCallback(
    (annotationId: string) => {
      setHoveredAnnotationIds((current) => {
        if (current.has(annotationId)) return current
        const next = new Set(current)
        next.add(annotationId)
        return next
      })
      timer.registerActivity('practice_interaction', { source: 'english_reading_hover' })
    },
    [timer],
  )

  const handleToggleExpandedSentence = useCallback(
    (sentenceId: string) => {
      setExpandedSentenceIds((current) => {
        const next = new Set(current)
        if (next.has(sentenceId)) {
          next.delete(sentenceId)
        } else {
          next.add(sentenceId)
        }
        return next
      })
      timer.registerActivity('practice_interaction', { source: 'english_reading_expand' })
    },
    [timer],
  )

  const handleCompleteReading = useCallback(
    async (feedback: ReadingSessionResult['feedback']) => {
      if (!material || !version) return
      setCompletionSubmitting(feedback)
      try {
        await timer.complete('manual_complete', { source: 'english_reading_complete' })
        const response = await completeEnglishReadingMaterialApi(material.id, {
          versionId: version.id,
          feedback,
          durationSeconds: Math.max(1, timer.effectiveSeconds),
          hoverCount: hoveredAnnotationIds.size,
          expandCount: expandedSentenceIds.size,
        })
        setCompletionResponse(response)
        setProfile(response.profile)
        setMaterial(response.material)
        setCompletionPanelOpen(true)
        await loadWorkspace()
        toast.success('阅读反馈已保存。')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存阅读反馈失败。')
      } finally {
        setCompletionSubmitting(null)
      }
    },
    [expandedSentenceIds.size, hoveredAnnotationIds.size, loadWorkspace, material, timer, version],
  )

  if (pageLoading || !profile) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">
        正在加载英语阅读...
      </div>
    )
  }

  const visibleStage = GENERATION_STAGES[generationStageIndex] || GENERATION_STAGES[0]

  return (
    <div className="space-y-6">
      <PageIntro
        title="英语阅读"
        description="在你的舒适区外半步处，持续制造真正能读进去的 i+1 材料。"
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              建立我的 i
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {CEFR_LEVELS.map((level) => {
                const active = profile.declaredCefr === level
                return (
                  <button
                    key={level}
                    type="button"
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-left transition-all',
                      active
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]'
                        : 'border-border/70 bg-background/75 hover:border-slate-300 hover:bg-white',
                    )}
                    onClick={() => void handleSelectLevel(level)}
                    disabled={profileSaving !== null}
                  >
                    <div className="text-[11px] uppercase tracking-[0.2em] opacity-70">CEFR</div>
                    <div className="mt-1.5 text-xl font-semibold">{level}</div>
                    {profileSaving === level ? (
                      <div className="mt-1.5 text-xs opacity-80">更新中...</div>
                    ) : null}
                  </button>
                )
              })}
            </div>

            <div className="rounded-3xl border border-border/70 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">升级进度</div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    当前等级 {profile.declaredCefr} · 距离下一等级 {Math.max(0, 100 - profile.levelProgress)} XP
                  </div>
                </div>
                <Badge variant="secondary">置信度 {Math.round(profile.confidence * 100)}%</Badge>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#1d4ed8,#0f766e,#16a34a)] transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, profile.levelProgress))}%` }}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">词汇舒适区</div>
                  <div className="mt-1.5 text-lg font-semibold">{formatWorkingBand(profile.workingLexicalI)}</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">句法舒适区</div>
                  <div className="mt-1.5 text-lg font-semibold">{formatWorkingBand(profile.workingSyntacticI)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                定制我的 i+1 材料
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => setAutomationOpen(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                自动化配置
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <Textarea
              value={textInput}
              onChange={handleTextInputChange}
              placeholder="直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。"
              className="min-h-[170px] resize-y rounded-3xl bg-background/70 px-4 py-4 text-[15px] leading-6.5"
            />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div
                role="button"
                tabIndex={0}
                aria-label="拖动或选择阅读文件"
                data-testid="reading-file-dropzone"
                className={cn(
                  'rounded-[28px] border border-dashed px-5 py-4 text-left transition-all',
                  dropzoneActive
                    ? 'border-sky-400 bg-sky-50 shadow-[0_20px_45px_rgba(59,130,246,0.14)]'
                    : 'border-border/70 bg-background/65 hover:border-slate-300 hover:bg-white/90',
                  generating ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                )}
                onClick={handleOpenFilePicker}
                onKeyDown={handleDropzoneKeyDown}
                onDragEnter={handleDropzoneDragEnter}
                onDragOver={handleDropzoneDragOver}
                onDragLeave={handleDropzoneDragLeave}
                onDrop={handleDropzoneDrop}
              >
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept={READING_FILE_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={handleFileInputChange}
                />
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors',
                      dropzoneActive
                        ? 'border-sky-300 bg-sky-100 text-sky-700'
                        : 'border-border/70 bg-card text-slate-600',
                    )}
                  >
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">
                      拖动 `txt / md / pdf` 到这里，或点击选择文件
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {sourceMode === 'file' && selectedFile
                        ? '当前将按文件导入生成。继续编辑上方正文可切回粘贴导入。'
                        : '你也可以完全不上传文件，直接粘贴英文正文开始生成。'}
                    </div>
                    {selectedFile ? (
                      <div className="mt-3 inline-flex max-w-full items-center rounded-full border border-border/70 bg-card px-3 py-1 text-sm text-slate-700">
                        <span className="truncate">已选择文件：{selectedFile.name}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <Button
                onClick={() => void handleCreateAndGenerate()}
                disabled={generating}
                className="h-11 rounded-2xl px-5"
              >
                {generating ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BookOpenText className="mr-2 h-4 w-4" />
                )}
                开始定制我的 i+1 材料
              </Button>
            </div>
            {generating ? (
              <div className="rounded-3xl border border-sky-200 bg-sky-50/80 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {visibleStage}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#2563eb)] transition-all"
                    style={{ width: `${((generationStageIndex + 1) / GENERATION_STAGES.length) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/70 bg-background/60 px-4 py-4 text-sm text-muted-foreground">
                当前支持手动粘贴，以及点击或拖动上传 `txt / md / pdf`。生成时会优先使用本地 CEFR 词典，不认识的词形再交给 Qwen Flash 补洞。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">最近阅读材料</CardTitle>
            <div className="text-xs text-muted-foreground">
              点击一条会直接打开这篇材料的最近阅读版本
            </div>
          </CardHeader>
          <CardContent>
            {recentMaterials.length > 0 ? (
              <div className="space-y-3">
                {Children.toArray(recentMaterials.map((item) => {
                  const active = material?.id === item.id
                  const busy = openingMaterialId === item.id || renamingMaterialId === item.id || deletingMaterialId === item.id
                  return createElement(
                    'div',
                    {
                      key: item.id,
                      className: cn(
                        'rounded-2xl border transition-all',
                        active
                          ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.12)]'
                          : 'border-border/70 bg-background/70',
                      ),
                    },
                    <>
                      <button
                        type="button"
                        className={cn(
                          'w-full rounded-t-2xl px-4 py-4 text-left transition-all',
                          active
                            ? 'hover:bg-slate-800'
                            : 'hover:border-slate-300 hover:bg-white',
                        )}
                        onClick={() => void handleOpenRecentMaterial(item)}
                        disabled={busy}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={active ? 'secondary' : 'outline'}>{item.sourceType.toUpperCase()}</Badge>
                              {item.latestVersionId ? (
                                <Badge variant={active ? 'secondary' : 'outline'}>已生成</Badge>
                              ) : (
                                <Badge variant={active ? 'secondary' : 'outline'}>仅已导入</Badge>
                              )}
                              <span className={cn('text-xs', active ? 'text-slate-200' : 'text-muted-foreground')}>
                                {item.wordCount} 词
                              </span>
                            </div>
                            <div className="mt-2 text-sm font-medium">{item.title}</div>
                            <div className={cn('mt-2 text-xs', active ? 'text-slate-300' : 'text-muted-foreground')}>
                              更新于 {item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '刚刚'}
                            </div>
                          </div>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px]',
                              active
                                ? 'border-slate-600 text-slate-200'
                                : 'border-border/70 text-muted-foreground',
                            )}
                          >
                            {openingMaterialId === item.id ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ExternalLink className="h-3.5 w-3.5" />
                            )}
                            打开
                          </span>
                        </div>
                      </button>
                      <div className={cn(
                        'flex items-center justify-end gap-2 border-t px-3 py-2',
                        active
                          ? 'border-slate-800/80 bg-slate-950/20'
                          : 'border-border/60 bg-background/60',
                      )}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(active ? 'text-slate-200 hover:bg-slate-800 hover:text-white' : '')}
                          onClick={() => void handleRenameRecentMaterial(item)}
                          disabled={busy}
                        >
                          {renamingMaterialId === item.id ? (
                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <PencilLine className="mr-2 h-4 w-4" />
                          )}
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(active ? 'text-slate-200 hover:bg-slate-800 hover:text-white' : '')}
                          onClick={() => void handleDeleteRecentMaterial(item)}
                          disabled={busy}
                        >
                          {deletingMaterialId === item.id ? (
                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </>,
                  )
                }))}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                还没有阅读历史。先导入一篇英文材料，生成后会自动出现在这里。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {versionLoading ? (
        <div className="flex min-h-[25vh] items-center justify-center text-sm text-muted-foreground">
          正在加载阅读面板...
        </div>
      ) : null}

      {material && !version && !versionLoading ? (
        <Card className="border-border/70 bg-card/95">
          <div ref={readingPanelRef} />
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{material.sourceType.toUpperCase()}</Badge>
              <Badge variant="outline">{material.wordCount} 词</Badge>
              <Badge variant="secondary">尚未生成阅读稿</Badge>
            </div>
            <CardTitle className="text-2xl">{material.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-dashed border-border/70 bg-background/60 px-5 py-6 text-sm text-muted-foreground">
              这篇材料已经进入阅读历史，但还没有生成可阅读版本。你可以直接继续生成，不需要重新上传。
            </div>
            <Button
              onClick={() => void runGeneration({ kind: 'regenerate', direction: 'same', delta: 0.5 })}
              disabled={generating}
              className="h-11 rounded-2xl px-5"
            >
              {generating ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              为这篇材料生成阅读稿
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {material && version ? (
        <Card className="overflow-hidden border-border/70 bg-card/95">
          <div ref={readingPanelRef} />
          <CardHeader className="space-y-4 border-b border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.94))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{material.sourceType.toUpperCase()}</Badge>
                  <Badge variant="secondary">目标 {version.targetCefr}</Badge>
                  <Badge variant="outline">{material.wordCount} 词</Badge>
                </div>
                <CardTitle className="text-2xl">{material.title}</CardTitle>
                <div className="text-sm text-muted-foreground">
                  黑色是舒适区，绿色是原文 i+1，黄色是升级表达，红色是降阶救援。
                </div>
              </div>
              <Button variant="outline" onClick={handleOpenRegenerateDialog} disabled={generating}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                重新生成内容
              </Button>
            </div>
            <SessionTimerBar
              effectiveSeconds={timer.effectiveSeconds}
              idleSeconds={timer.idleSeconds}
              pauseCount={timer.pauseCount}
              status={timer.status}
              onStart={() => timer.start({ source: 'manual_start' })}
              onPause={() => timer.pause({ source: 'manual_pause' })}
              onResume={() => timer.resume({ source: 'manual_resume' })}
              onAdjustDuration={timer.adjustDuration}
              showCompleteAction={false}
              showRestartAction
              onRestart={() => timer.reset()}
              layout="compact"
            />
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-[32px] border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.10),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_28%),linear-gradient(180deg,rgba(255,252,245,0.96),rgba(255,255,255,0.98))] px-5 py-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] sm:px-8 sm:py-9">
              <div className="mx-auto max-w-4xl space-y-6 text-[1.05rem] leading-9 text-slate-800 sm:text-[1.1rem]">
                {version.renderBlocks.map((block) => (
                  <div key={block.id} className="space-y-3">
                    {block.sentences.map((sentence) => (
                      <SentenceLine
                        key={sentence.id}
                        sentence={sentence}
                        sentenceAnnotation={sentenceAnnotationMap.get(sentence.sentenceAnnotationId)}
                        annotationMap={annotationMap}
                        expanded={expandedSentenceIds.has(sentence.id)}
                        onHoverAnnotation={handleAnnotationHover}
                        onToggleExpanded={() => handleToggleExpandedSentence(sentence.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>

              <div className="mx-auto mt-8 flex max-w-4xl flex-col gap-4 border-t border-slate-200/80 pt-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    绿色 {version.summary.greenCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    黄色 {version.summary.yellowCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    红色 {version.summary.redCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    句法重构 {version.summary.sentenceSimplifiedCount}
                  </span>
                </div>
                <Button
                  size="lg"
                  className="rounded-2xl px-7"
                  onClick={() => setCompletionPanelOpen((current) => !current)}
                >
                  我读完了
                </Button>
              </div>
            </div>

            {completionPanelOpen ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
                <Card className="border-border/70 bg-background/85">
                  <CardHeader>
                    <CardTitle className="text-base">本次阅读反馈</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                        <div className="text-xs text-muted-foreground">当前用时</div>
                        <div className="mt-2 text-lg font-semibold">{formatMinutes(timer.effectiveSeconds)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                        <div className="text-xs text-muted-foreground">已接触增长内容</div>
                        <div className="mt-2 text-lg font-semibold">
                          {version.summary.greenCount + version.summary.yellowCount}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void handleCompleteReading('too_easy')}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === 'too_easy' ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        太简单
                      </Button>
                      <Button
                        onClick={() => void handleCompleteReading('just_right')}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === 'just_right' ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        刚刚好
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleCompleteReading('too_hard')}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === 'too_hard' ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        有点难
                      </Button>
                    </div>
                    <div className="rounded-2xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                      系统会根据你的主观反馈、阅读速度、悬浮次数和句法展开次数，只校准下一篇材料的内部难度，不会突然把当前文章改掉。
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-background/85">
                  <CardHeader>
                    <CardTitle className="text-base">努力的痕迹</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {completionResponse ? (
                      <div className="space-y-3 text-sm">
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          本次阅读用时：{formatMinutes(completionResponse.session.durationSeconds)}
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          阅读速度：{completionResponse.session.wordsPerMinute} 词/分钟
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          你与 {version.summary.greenCount + version.summary.yellowCount} 个 i+1 词汇进行了亲密接触，并无痛掠过了 {version.summary.redCount} 个超纲词。
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-800">
                          本次反馈：{summarizeFeedback(completionResponse.session.feedback)} · 获得 {completionResponse.session.xpAwarded} XP
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          当前等级：{completionResponse.profile.declaredCefr} · 升级进度 {completionResponse.profile.levelProgress}/100
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                        选择一个反馈后，这里会出现本次阅读的温和回顾。
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!material && !versionLoading ? (
        <Card className="border-border/70 bg-card/95">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div className="text-base font-medium">先导入一篇英文材料</div>
            <div className="max-w-xl text-sm text-muted-foreground">
              你可以先粘贴全文，或者上传 `txt / md / pdf`。系统会基于本地词典和 Qwen Flash，把它改造成真正能读进去的 i+1 阅读稿。
            </div>
          </CardContent>
        </Card>
      ) : null}

      <TimerAutomationDialog
        open={automationOpen}
        config={automationConfig}
        onOpenChange={setAutomationOpen}
        onSave={(nextConfig) => {
          const saved = saveTimerAutomationConfig(nextConfig)
          setAutomationConfig(saved)
        }}
        onReset={() => {
          const reset = resetTimerAutomationConfig()
          setAutomationConfig(reset)
        }}
      />

      <Dialog
        open={regenerateDialogOpen}
        onOpenChange={(open) => {
          if (generating) return
          setRegenerateDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div>
              <DialogTitle>重新生成内容</DialogTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                本次会对当前整篇文章重新生成，不会只调整未读部分。
              </div>
            </div>
            <DialogClose onClick={() => setRegenerateDialogOpen(false)} />
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  value: 'easier' as const,
                  title: '降低难度',
                  description: '把这篇文章调得更容易读进去。',
                },
                {
                  value: 'same' as const,
                  title: '重新生成',
                  description: '保持当前难度，刷新一版新的阅读稿。',
                },
                {
                  value: 'harder' as const,
                  title: '提升难度',
                  description: '把这篇文章调得更有挑战一些。',
                },
              ].map((option) => {
                const active = regenerateDirection === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={generating}
                    onClick={() => setRegenerateDirection(option.value)}
                    className={cn(
                      'rounded-2xl border px-4 py-4 text-left transition-all',
                      active
                        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]'
                        : 'border-border/70 bg-background/80 hover:border-slate-300 hover:bg-white',
                      generating && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <div className="text-sm font-semibold">{option.title}</div>
                    <div className={cn('mt-2 text-xs leading-5', active ? 'text-slate-200' : 'text-muted-foreground')}>
                      {option.description}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/75 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="reading-regenerate-delta" className="text-sm font-medium">
                  难度变化幅度
                </Label>
                <span className="text-sm font-semibold text-slate-900">{formatDifficultyDelta(regenerateDelta)}</span>
              </div>
              <Input
                id="reading-regenerate-delta"
                type="range"
                min="0.5"
                max="2"
                step="0.5"
                value={regenerateDelta}
                disabled={generating}
                onChange={(event) => setRegenerateDelta(Number(event.currentTarget.value) as ReadingDifficultyDelta)}
                className="mt-4"
              />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                {READING_DIFFICULTY_OPTIONS.map((option) => (
                  <span key={option}>{option}</span>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                选择“重新生成”时会忽略这个幅度，并按当前难度刷新内容。
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setRegenerateDialogOpen(false)}
              disabled={generating}
            >
              取消
            </Button>
            <Button onClick={() => void handleConfirmRegenerate()} disabled={generating}>
              {generating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认生成
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}






