import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { ImagePlus, LoaderCircle, Play, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/shared/feedback/toast'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import {
  autoGenerateAndSavePalaceQuiz,
  type QuizGenerationRequestConfig,
  type QuizLauncherGenerationSourceKind,
} from '@/features/palace-quiz/quizGenerationController'
import type { MindMapEditorState, PalaceQuizQuestionType } from '@/shared/api/contracts'
import { getPalaceApi } from '@/entities/palace/api'
import {
  completeTask,
  failTask,
  registerTask,
  updateTask,
} from '@/shared/background-tasks/backgroundTaskRegistry'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'

type QuizLauncherScene = 'edit' | 'practice' | 'review'

interface QuizLauncherRequest {
  palaceId: number
  scene: QuizLauncherScene
  reviewEditorDoc?: MindMapEditorState['editor_doc']
}

interface QuizLauncherContextValue {
  openQuizLauncher: (request: QuizLauncherRequest) => void
}

interface LauncherPalaceMeta {
  id: number
  title: string
  mini_palaces?: Array<{ id: number; name: string }>
  chapters?: Array<{
    id: number
    subject?: { id: number; name: string } | null
  }>
}

const QUIZ_LAUNCHER_QUESTION_TYPES: PalaceQuizQuestionType[] = [
  'multiple_choice',
  'true_false',
  'fill_blank',
  'matching',
  'ordering',
  'categorization',
  'short_answer',
]

const QuizLauncherContext = createContext<QuizLauncherContextValue | null>(null)

function getDefaultSourceKind(scene: QuizLauncherScene): QuizLauncherGenerationSourceKind {
  return scene === 'review' ? 'review-mindmap' : 'image-single'
}

export function QuizLauncherProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const [request, setRequest] = useState<QuizLauncherRequest | null>(null)
  const [palace, setPalace] = useState<LauncherPalaceMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [sourceKind, setSourceKind] = useState<QuizLauncherGenerationSourceKind>('image-single')
  const [extraPrompt, setExtraPrompt] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [questionCount, setQuestionCount] = useState(6)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()

  useEffect(() => {
    if (!request) return
    setLoading(true)
    setError('')
    setSourceKind(getDefaultSourceKind(request.scene))
    let cancelled = false
    void getPalaceApi(request.palaceId)
      .then((palaceResponse) => {
        if (cancelled) return
        setPalace(palaceResponse as LauncherPalaceMeta)
      })
      .catch((nextError) => {
        if (cancelled) return
        setError(nextError instanceof Error ? nextError.message : '加载做题入口失败。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [request])

  const closeLauncher = useCallback(() => {
    setRequest(null)
    setLoading(false)
    setStarting(false)
    setError('')
    setExtraPrompt('')
    setImageFiles([])
    setQuestionCount(6)
  }, [])

  const openQuizLauncher = useCallback((nextRequest: QuizLauncherRequest) => {
    setRequest(nextRequest)
  }, [])

  const contextValue = useMemo<QuizLauncherContextValue>(
    () => ({ openQuizLauncher }),
    [openQuizLauncher],
  )

  const handleDirectEnter = () => {
    if (!request) return
    dispatchGlobalFeedback('quiz_nav_open_practice', {
      label: '直接进入做题',
      audioScope: 'global',
    })
    navigate(`/palaces/${request.palaceId}/quiz?tab=practice`)
    closeLauncher()
  }

  const buildGenerationConfig = async (): Promise<QuizGenerationRequestConfig | null> => {
    if (!request || !palace) return null
    if (sourceKind === 'review-mindmap') {
      if (!request.reviewEditorDoc) {
        throw new Error('当前复习上下文缺少脑图数据，暂时无法直接生成题目。')
      }
      return {
        palaceId: request.palaceId,
        sourceKind,
        extraPrompt,
        reviewMindmap: {
          mode: 'chapter',
          question_types: QUIZ_LAUNCHER_QUESTION_TYPES,
          question_count: Math.max(1, Math.min(12, questionCount)),
          review_editor_doc: request.reviewEditorDoc,
        },
      }
    }
    if (imageFiles.length === 0) {
      throw new Error(sourceKind === 'text-files' ? '请先上传文本文件。' : '请先上传图片。')
    }
    return {
      palaceId: request.palaceId,
      sourceKind,
      extraPrompt,
      files: sourceKind === 'image-single' ? imageFiles.slice(0, 1) : imageFiles,
    }
  }

  const handleStartGeneration = async () => {
    if (!request || !palace) return
    setStarting(true)
    setError('')
    try {
      const generationConfig = await buildGenerationConfig()
      if (!generationConfig) return
      const aiOptions = await promptForAiOptions({
        scenarioKey:
          sourceKind === 'review-mindmap'
            ? 'quiz_review_mindmap_generation'
            : 'quiz_image_generation',
        entrypointKey:
          sourceKind === 'review-mindmap'
            ? 'quiz-generate-review-mindmap'
            : sourceKind === 'image-batch'
                ? 'quiz-generate-images-batch'
                : 'quiz-generate-images-single',
        title:
          sourceKind === 'review-mindmap'
            ? '复习脑图做题生成配置'
            : '图片做题生成配置',
      })
      if (!aiOptions) {
        dispatchGlobalFeedback('quiz_generate_cancel', {
          label: '取消生成',
          audioScope: 'global',
        })
        setStarting(false)
        return
      }
      dispatchGlobalFeedback('quiz_generate_start', {
        label: sourceKind === 'review-mindmap' ? '复习脑图出题' : '开始生成',
        audioScope: 'global',
      })
      const taskId = `quiz-generation-${request.palaceId}-${Date.now()}`
      const navigateTarget = `/palaces/${request.palaceId}/quiz?tab=practice`
      registerTask({
        id: taskId,
        section: 'palaces',
        kind: 'quiz-generation',
        title: `${palace.title} · 题库生成中`,
        detail: '已缩成气泡，你可以继续操作脑图。',
        progress: 8,
        navigateTarget,
      })

      closeLauncher()

      void (async () => {
        try {
          if (sourceKind === 'review-mindmap') {
            updateTask(taskId, {
              progress: 25,
              detail: '正在根据当前复习脑图生成题目…',
            })
          } else {
            updateTask(taskId, {
              progress: 18,
              detail: '正在识别图片并生成题目…',
            })
          }

          const result = await autoGenerateAndSavePalaceQuiz({
            ...generationConfig,
            aiOptions,
          })

          updateTask(taskId, {
            progress: 96,
            detail: '正在写入题库…',
          })
          completeTask(taskId, {
            detail:
              result.savedCount > 0
                ? `已保存 ${result.savedCount} 题，点击去做题。`
                : '生成完成，但没有可保存的新题。',
            progress: 100,
          })
          dispatchGlobalFeedback('quiz_generate_save', {
            label: result.savedCount > 0 ? '已入题库' : '生成完成',
            audioScope: 'global',
          })
          toast.success(
            result.savedCount > 0 ? `已保存 ${result.savedCount} 道题目` : '生成完成',
          )
        } catch (nextError) {
          const message =
            nextError instanceof Error ? nextError.message : '生成题目失败。'
          failTask(taskId, message)
          dispatchGlobalFeedback('quiz_error_ai_failed', {
            label: '生成失败',
            audioScope: 'global',
          })
          toast.error(message)
        }
      })()
    } catch (nextError) {
      dispatchGlobalFeedback('quiz_error_missing_input', {
        label: '生成题目失败',
        audioScope: 'local',
      })
      setError(nextError instanceof Error ? nextError.message : '生成题目失败。')
    } finally {
      setStarting(false)
    }
  }

  return (
    <QuizLauncherContext.Provider value={contextValue}>
      {children}
      {aiRunConfigDialog}
      <Dialog open={Boolean(request)} onOpenChange={(open) => !open && closeLauncher()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div>
              <DialogTitle>做题</DialogTitle>
              <DialogDescription>
                这里可以直接进入当前宫殿做题页，也可以先生成新题。生成开始后会缩成可拖拽气泡，不会打断你继续看脑图。
              </DialogDescription>
            </div>
            <DialogClose onClick={closeLauncher} />
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                正在准备做题入口…
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border/70 bg-background/70 p-4">
                  <div className="text-sm font-medium">
                    {palace?.title ? `${palace.title} · 做题入口` : '做题入口'}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    直接进入当前宫殿做题页，或者先生成新题再去做。
                  </div>
                  <div className="mt-3">
                    <Button type="button" onClick={handleDirectEnter}>
                      <Play className="size-4" />
                      直接进入做题
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    {request?.scene === 'review' ? (
                      <Button
                        type="button"
                        variant={sourceKind === 'review-mindmap' ? 'default' : 'outline'}
                        onClick={() => {
                          dispatchGlobalFeedback('quiz_nav_scope_change', {
                            label: '复习脑图',
                            audioScope: 'global',
                          })
                          setSourceKind('review-mindmap')
                        }}
                      >
                        <Sparkles className="size-4" />
                        基于当前复习脑图
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant={sourceKind === 'image-single' ? 'default' : 'outline'}
                      onClick={() => {
                        dispatchGlobalFeedback('quiz_nav_scope_change', {
                          label: '单图',
                          audioScope: 'global',
                        })
                        setSourceKind('image-single')
                      }}
                    >
                      <ImagePlus className="size-4" />
                      单图
                    </Button>
                    <Button
                      type="button"
                      variant={sourceKind === 'image-batch' ? 'default' : 'outline'}
                      onClick={() => {
                        dispatchGlobalFeedback('quiz_nav_scope_change', {
                          label: '多图',
                          audioScope: 'global',
                        })
                        setSourceKind('image-batch')
                      }}
                    >
                      <Sparkles className="size-4" />
                      多图
                    </Button>
                  </div>

                  {sourceKind === 'review-mindmap' ? (
                    <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-end">
                      <label className="grid gap-2">
                        <span className="text-sm font-medium">题目数量</span>
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          value={questionCount}
                          onChange={(event) => setQuestionCount(Number(event.target.value))}
                        />
                      </label>
                      <div className="rounded-xl border border-border/70 bg-muted/35 px-3 py-3 text-sm text-muted-foreground">
                        会基于你当前看到的复习脑图生成一组综合题，并在完成后自动写入题库。
                      </div>
                    </div>
                  ) : null}

                  {sourceKind === 'image-single' || sourceKind === 'image-batch' ? (
                    <div className="space-y-3">
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">上传图片</span>
                        <Input
                          type="file"
                          multiple={sourceKind === 'image-batch'}
                          accept="image/*"
                          onChange={(event) => {
                            dispatchGlobalFeedback('quiz_generate_attach_source', {
                              label: '选择图片',
                              audioScope: 'local',
                            })
                            setImageFiles(Array.from(event.target.files || []))
                          }}
                        />
                      </label>
                      {imageFiles.length > 0 ? (
                        <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                          已选择：{imageFiles.map((file) => file.name).join('、')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">补充提示</span>
                    <Textarea
                      value={extraPrompt}
                      onChange={(event) => setExtraPrompt(event.target.value)}
                      rows={4}
                      placeholder="可选：补充本次希望强调的知识点、题型风格或范围。"
                    />
                  </label>
                </div>

                {error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className={cn(loading && 'justify-end')}>
            <Button type="button" variant="outline" onClick={closeLauncher}>
              取消
            </Button>
            <Button type="button" disabled={loading || starting} onClick={() => void handleStartGeneration()}>
              {starting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              生成新题并稍后去做
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </QuizLauncherContext.Provider>
  )
}

export function useQuizLauncher() {
  const context = useContext(QuizLauncherContext)
  if (!context) {
    throw new Error('useQuizLauncher 必须在 QuizLauncherProvider 中使用。')
  }
  return context
}
