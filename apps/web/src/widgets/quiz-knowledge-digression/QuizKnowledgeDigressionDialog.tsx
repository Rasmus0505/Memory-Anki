import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { getPalaceEditorApi, MindMapEditorSurface } from '@/modules/content/public'
import { buildEditorState } from '@/widgets/palace-memory-lookup/model/memoryLookupDialogSupport'
import type { MindMapEditorState, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'

/**
 * Fullscreen readonly mindmap digression from quiz practice.
 * Holds no quiz state — parent keeps attempt draft in memory while this overlay is open.
 */
export function QuizKnowledgeDigressionDialog({
  open,
  onOpenChange,
  edge,
  returnLabel = '返回做题',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  edge: QuizNodeBindingEdge | null
  returnLabel?: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [focusNonce, setFocusNonce] = useState(0)

  const targetPalaceId = edge?.target_palace_id ?? edge?.palace_id ?? null
  const nodeUid = edge?.node_uid ? String(edge.node_uid) : null
  const title =
    edge?.target_palace_title ||
    (targetPalaceId != null ? `宫殿 ${targetPalaceId}` : '知识点导图')

  useEffect(() => {
    if (!open || targetPalaceId == null) {
      setEditorState(null)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    void getPalaceEditorApi(targetPalaceId)
      .then((response) => {
        if (cancelled) return
        setEditorState(buildEditorState(response))
        setFocusNonce((value) => value + 1)
      })
      .catch((err) => {
        if (!cancelled) {
          setEditorState(null)
          setError(err instanceof Error ? err.message : '加载导图失败。')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, targetPalaceId])

  // System back on PWA: push a history entry so Back closes digression first.
  useEffect(() => {
    if (!open) return
    const token = `quiz-knowledge-digression:${targetPalaceId ?? 'x'}:${nodeUid ?? 'n'}`
    window.history.pushState({ quizKnowledgeDigression: token }, '')
    const onPop = () => {
      onOpenChange(false)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [open, targetPalaceId, nodeUid, onOpenChange])

  const highlight = useMemo(() => (nodeUid ? [nodeUid] : []), [nodeUid])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent
        layout="unstyled"
        className={cn(
          'fixed inset-0 z-[250] flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-card p-0 shadow-2xl',
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-card/95 px-3 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur">
          <Button
            type="button"
            size="lg"
            className="h-12 min-w-[7.5rem] gap-2 px-4 text-base"
            onClick={() => onOpenChange(false)}
          >
            <ArrowLeft className="size-5" />
            {returnLabel}
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {edge?.node_text || nodeUid || '只读导图 · 关闭后继续做题'}
              {edge?.is_cross_palace ? ' · 跨宫引用' : ''}
            </DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在加载完整导图…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            </div>
          ) : editorState ? (
            <MindMapEditorSurface
              key={`digression-${targetPalaceId}-${nodeUid}-${focusNonce}`}
              editorState={editorState}
              readonly
              presentationStrategy="viewport-only"
              mobileViewPolicy="map"
              focusRequestNodeUid={nodeUid}
              focusRequestNonce={focusNonce}
              highlightedNodeUids={highlight}
              initialViewPolicy="reset"
              onEditorStateChange={() => {}}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无导图内容。
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function QuizKnowledgeEdgePicker({
  open,
  onOpenChange,
  edges,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  edges: QuizNodeBindingEdge[]
  onSelect: (edge: QuizNodeBindingEdge) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>选择知识点</DialogTitle>
        <DialogDescription>该题绑定了多个节点，请选择要打开的导图位置。</DialogDescription>
        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {edges.map((edge) => {
            const key = `${edge.palace_id ?? edge.target_palace_id}:${edge.node_uid}:${edge.question_id}`
            const palaceLabel =
              edge.target_palace_title ||
              (edge.target_palace_id != null || edge.palace_id != null
                ? `宫殿 ${edge.target_palace_id ?? edge.palace_id}`
                : '宫殿')
            return (
              <button
                key={key}
                type="button"
                className="flex w-full flex-col rounded-lg border border-border/70 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => {
                  onSelect(edge)
                  onOpenChange(false)
                }}
              >
                <span className="text-sm font-medium">{edge.node_text || edge.node_uid}</span>
                <span className="text-xs text-muted-foreground">
                  {palaceLabel}
                  {edge.is_cross_palace ? ' · 跨宫' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
