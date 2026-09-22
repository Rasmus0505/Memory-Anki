import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { getPalaceApi } from '@/modules/content/public'
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
}

const QuizLauncherContext = createContext<QuizLauncherContextValue | null>(null)

export function QuizLauncherProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const [request, setRequest] = useState<QuizLauncherRequest | null>(null)
  const [palace, setPalace] = useState<LauncherPalaceMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!request) return
    setLoading(true)
    setError('')
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
    setError('')
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

  return (
    <QuizLauncherContext.Provider value={contextValue}>
      {children}
      <Dialog open={Boolean(request)} onOpenChange={(open) => !open && closeLauncher()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div>
              <DialogTitle>做题</DialogTitle>
              <DialogDescription>直接进入当前宫殿做题。</DialogDescription>
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
                    直接进入当前宫殿做题页。
                  </div>
                  <div className="mt-3">
                    <Button type="button" onClick={handleDirectEnter}>
                      <Play className="size-4" />
                      直接进入做题
                    </Button>
                  </div>
                </div>
                {error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeLauncher}>
              取消
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
