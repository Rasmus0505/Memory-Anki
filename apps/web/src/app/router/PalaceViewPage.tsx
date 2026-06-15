import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Target } from 'lucide-react'
import { useQuizLauncher } from '@/features/palace-quiz/QuizLauncherProvider'
import { buildAttachmentUrl, getPalaceEditorApi, savePalaceEditorApi } from '@/shared/api/modules/palaces'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { LoadingState } from '@/shared/components/state-placeholders'
import {
  MindMapFrame,
  MindMapPageToolbar,
  type MindMapFrameHandle,
} from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import { cn } from '@/shared/lib/utils'

interface PalaceMeta {
  id: number
  title: string
  description: string
  mastered: boolean
  focus_count?: number
  attachments: Array<{ id: number; original_name: string }>
  chapters: Array<{ id: number; name: string; subject?: { id: number; name: string } | null }>
}

export default function PalaceView() {
  const { id } = useParams()
  const { openQuizLauncher } = useQuizLauncher()
  const palaceId = id ? Number(id) : null
  const mindMapFrameRef = useRef<MindMapFrameHandle | null>(null)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [mindMapNativeFullscreen, setMindMapNativeFullscreen] = useState(false)
  const [mindMapUiCleared, setMindMapUiCleared] = useState(false)
  const [shouldMountMindMap, setShouldMountMindMap] = useState(false)

  const { meta, editorState, isLoading, error } = usePersistedMindMapEditor({
    entityId: palaceId,
    fetcher: getPalaceEditorApi,
    saver: savePalaceEditorApi,
    selectMeta: (response) => response.palace as PalaceMeta,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
      editor_fingerprint: response.editor_fingerprint,
    }),
  })

  const palace = meta as PalaceMeta | null

  useEffect(() => {
    if (!palace || !editorState) {
      setShouldMountMindMap(false)
      return
    }
    let cancelled = false
    const scheduleMount = () => {
      if (!cancelled) {
        setShouldMountMindMap(true)
      }
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const frameId = window.requestAnimationFrame(() => {
        window.setTimeout(scheduleMount, 0)
      })
      return () => {
        cancelled = true
        window.cancelAnimationFrame(frameId)
      }
    }
    const timeoutId = window.setTimeout(scheduleMount, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [editorState, palace])

  if (!palaceId || (!palace && isLoading)) {
    return <LoadingState text="正在加载宫殿详情…" />
  }

  if (!palace || !editorState) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-destructive">{error || '未找到该宫殿。'}</div>
  }

  const handleImmersiveToolbarToggle = async () => {
    if (mindMapNativeFullscreen) {
      await mindMapFrameRef.current?.exitNativeFullscreen()
      setMindMapFullscreen(true)
      return
    }
    setMindMapFullscreen((current) => !current)
  }

  const handleNativeFullscreenToolbarToggle = async () => {
    if (mindMapNativeFullscreen) {
      await mindMapFrameRef.current?.exitNativeFullscreen()
      return
    }
    if (mindMapFullscreen) {
      setMindMapFullscreen(false)
    }
    await mindMapFrameRef.current?.enterNativeFullscreen()
  }

  const handleOpenQuizPage = () => {
    openQuizLauncher({
      palaceId: palace.id,
      scene: 'practice',
    })
  }

  return (
    <div className="space-y-5">
      {!mindMapFullscreen ? (
        <PageIntro
          eyebrow="宫殿详情"
          title={palace.title}
          description="这是只读脑图视图。难度与旧的 review mode 已从产品界面移除。"
          actions={
            <>
              <Link to="/palaces">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回列表
                </Button>
              </Link>
              {(palace.focus_count ?? 0) > 0 ? (
                <Link to={`/palaces/${palace.id}/focus-practice`}>
                  <Button variant="outline" size="sm" className="border-warning/30 bg-warning/5 text-warning hover:bg-warning/10">
                    <Target className="mr-2 h-4 w-4" />
                    专项练习 {palace.focus_count}
                  </Button>
                </Link>
              ) : null}
              <Badge variant="secondary">只读脑图</Badge>
            </>
          }
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          className={cn(
            'min-h-[72vh] border-border/70 bg-card/92',
            mindMapFullscreen && 'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
          )}
        >
          <CardHeader>
            <CardTitle className="text-base">宫殿脑图</CardTitle>
          </CardHeader>
          <CardContent className={cn('min-h-[62vh]', mindMapFullscreen && 'h-[calc(100vh-108px)] min-h-0')}>
            <div className="flex h-full min-h-0 flex-col gap-3">
              <MindMapPageToolbar
                quizAction={{
                  label: '做题',
                  onClick: handleOpenQuizPage,
                }}
                immersiveAction={{
                  label: '半屏编辑',
                  active: mindMapFullscreen,
                  onClick: () => {
                    void handleImmersiveToolbarToggle()
                  },
                }}
                nativeFullscreenAction={{
                  label: '全屏编辑',
                  active: mindMapNativeFullscreen,
                  onClick: () => {
                    void handleNativeFullscreenToolbarToggle()
                  },
                }}
                clearUiAction={{
                  label: '清屏',
                  active: mindMapUiCleared,
                  onClick: () => mindMapFrameRef.current?.toggleUiCleared(),
                }}
              />
              {shouldMountMindMap ? (
                <MindMapFrame
                  ref={mindMapFrameRef}
                  key={`readonly-${palace.id}`}
                  editorState={editorState}
                  readonly
                  immersiveModeActive={mindMapFullscreen}
                  onEditorStateChange={() => {}}
                  onFullscreenToggle={setMindMapFullscreen}
                  onFullscreenChange={setMindMapNativeFullscreen}
                  onUiClearedChange={setMindMapUiCleared}
                  className={cn(
                    'w-full flex-1 rounded-2xl border border-border/70 bg-background',
                    mindMapFullscreen ? 'h-full' : 'h-[62vh]',
                  )}
                />
              ) : (
                <LoadingState
                  text="正在准备脑图视图…"
                  className={cn(
                    'w-full flex-1 rounded-2xl border border-border/70 bg-background px-4',
                    mindMapFullscreen ? 'h-full' : 'h-[62vh]',
                  )}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <div className={cn('space-y-4', mindMapFullscreen && 'hidden')}>
          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">概要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {palace.mastered ? <Badge variant="secondary">已掌握</Badge> : null}
              {(palace.focus_count ?? 0) > 0 ? (
                <Badge variant="outline" className="border-warning/30 text-warning">
                  专项 {palace.focus_count} 张
                </Badge>
              ) : null}
              <div className="rounded-2xl bg-background/70 p-3 whitespace-pre-wrap">
                {palace.description || '当前宫殿没有补充描述。'}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">关联章节</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {palace.chapters.length > 0 ? (
                palace.chapters.map((chapter) => (
                  <div key={chapter.id} className="rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
                    <div className="font-medium">{chapter.name}</div>
                    <div className="text-muted-foreground">{chapter.subject?.name || '未分类学科'}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-muted-foreground">
                  该宫殿还没有关联章节。
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">附件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {palace.attachments.length > 0 ? (
                palace.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={buildAttachmentUrl(attachment.id)}
                    target="_blank"
                    className="block rounded-2xl border border-border/70 bg-background/70 px-3 py-3 transition-colors hover:text-foreground"
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {attachment.original_name}
                    </span>
                  </a>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 px-3 py-4 text-muted-foreground">
                  没有附件。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
