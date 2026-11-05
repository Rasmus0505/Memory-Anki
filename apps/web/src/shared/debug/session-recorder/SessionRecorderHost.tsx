import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleDot, LocateFixed, NotebookPen, TriangleAlert } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import { toast } from '@/shared/feedback/toast'
import {
  closeSessionRecorderDialog,
  copyLastClickFocusToClipboard,
  copyRecentBriefToClipboard,
  deleteSelectedSessionRecorderHistory,
  ensureSessionRecorderCapture,
  getSelectedSessionRecorder,
  getSessionRecorderCopyText,
  openSessionRecorderDialog,
  pinLiveBriefToHistory,
  recordSessionRecorderRoute,
  selectSessionRecorderHistory,
  updateSelectedSessionRecorderNotes,
  updateSelectedSessionRecorderReport,
} from './sessionRecorderStore'
import { LIVE_BRIEF_ID } from './sessionRecorderTypes'
import { DIAGNOSIS_WINDOW_OPTIONS_MINUTES } from './sessionRecorderBrief'
import { useSessionRecorderState } from './useSessionRecorderState'

export const SESSION_RECORDER_LAYER_ZCLASS = 'z-[20000]'

async function copyText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return true
  }
  return false
}

function SessionRecorderDialog() {
  const state = useSessionRecorderState()
  const selected = getSelectedSessionRecorder()
  const showingLive = state.viewingLive || !selected
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    setCopied(false)
    setCopyFailed(false)
  }, [state.selectedId, state.dialogOpen, state.viewingLive])

  const handleCopy = async () => {
    if (showingLive) pinLiveBriefToHistory()
    const text = getSessionRecorderCopyText()
    const ok = await copyText(text)
    setCopied(ok)
    setCopyFailed(!ok)
  }

  return (
    <Dialog
      open={state.dialogOpen}
      onOpenChange={(open) => {
        if (open) openSessionRecorderDialog()
        else closeSessionRecorderDialog()
      }}
    >
      <DialogContent className="max-w-2xl" floating={false} showCloseButton data-session-recorder="true">
        <DialogHeader>
          <DialogTitle>刚才几分钟</DialogTitle>
          <DialogDescription>上面是刚才的说明，可以直接贴给 AI。下面可以补一句你看到了什么。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">历史记录</span>
            <select
              aria-label="历史记录"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={showingLive ? LIVE_BRIEF_ID : selected.id}
              onChange={(event) => selectSessionRecorderHistory(event.target.value)}
            >
              <option value={LIVE_BRIEF_ID}>刚才几分钟</option>
              {state.history.map((session) => (
                <option key={session.id} value={session.id}>
                  {new Date(session.startedAt).toLocaleString('zh-CN')}
                  {session.notes.trim() ? ` · ${session.notes.trim().slice(0, 16)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">给 AI 的说明</span>
            <Textarea
              aria-label="给 AI 的说明"
              className="min-h-40 text-sm"
              value={showingLive ? state.liveReport : selected.reportText}
              placeholder="这几分钟还没有点到什么。"
              onChange={(event) => updateSelectedSessionRecorderReport(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">你看到了什么</span>
            <Textarea
              aria-label="刚才碰到什么问题？（可选）"
              className="min-h-24"
              value={showingLive ? state.liveNotes : selected.notes}
              placeholder="刚才碰到什么问题？（可选）"
              onChange={(event) => updateSelectedSessionRecorderNotes(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={showingLive}
            onClick={() => deleteSelectedSessionRecorderHistory()}
          >
            删除
          </Button>
          <Button type="button" onClick={() => void handleCopy()}>
            {copied ? '已复制' : copyFailed ? '请手动复制' : '复制给 AI'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One 「工具」 menu for diagnostics: copy the last few minutes for AI, copy the
 * last click, open the brief, plus whatever the host adds (logs, version).
 * The sidebar footer and the phone top bar render it inline; immersive phone
 * pages have neither, so the host floats the same menu in the top-right corner.
 */
export function SessionRecorderMenu({
  children,
  side = 'top',
  align = 'start',
  triggerClassName,
}: {
  /** Extra items appended below the recorder actions. */
  children?: ReactNode
  side?: 'top' | 'bottom' | 'right'
  align?: 'start' | 'end'
  triggerClassName?: string
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const settle = (ok: boolean, okMessage: string) => {
    setStatus(ok ? 'copied' : 'failed')
    if (ok) toast.success(okMessage)
    else {
      toast.error('复制失败，请在弹窗里手动复制')
      openSessionRecorderDialog()
    }
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => setStatus('idle'), 2500)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="录制"
          title="调试工具：复制最近几分钟的操作给 AI、查看日志"
          className={triggerClassName}
          data-session-recorder="true"
        >
          {status === 'copied' ? <Check className="text-success" /> : status === 'failed' ? <TriangleAlert className="text-warning" /> : <CircleDot />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-56" data-session-recorder="true">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">复制给 AI</DropdownMenuLabel>
        {DIAGNOSIS_WINDOW_OPTIONS_MINUTES.map((minutes) => (
          <DropdownMenuItem
            key={minutes}
            aria-label={`复制最近 ${minutes} 分钟`}
            onSelect={() => void copyRecentBriefToClipboard(minutes).then((ok) => settle(ok, '已复制，去粘贴给 AI'))}
          >
            <CircleDot />
            最近 {minutes} 分钟
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          aria-label="复制上一次点击的位置"
          onSelect={() => void copyLastClickFocusToClipboard().then((ok) => settle(ok, '已复制上一次点击的位置'))}
        >
          <LocateFixed />
          上一次点击的位置
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSessionRecorderDialog()}>
          <NotebookPen />
          查看并补充说明
        </DropdownMenuItem>
        {children ? <DropdownMenuSeparator /> : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SessionRecorderHost({ floating = false }: { floating?: boolean }) {
  const location = useLocation()

  useEffect(() => {
    ensureSessionRecorderCapture()
  }, [])

  useEffect(() => {
    recordSessionRecorderRoute(location.pathname)
  }, [location.pathname])

  const floatingLayer = floating && typeof document !== 'undefined'
    ? createPortal(
        <div
          className={cn(
            'pointer-events-auto fixed right-2 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] md:hidden',
            SESSION_RECORDER_LAYER_ZCLASS,
          )}
          data-session-recorder="true"
          data-session-recorder-hud="true"
        >
          <SessionRecorderMenu side="bottom" align="end" triggerClassName="size-9 rounded-full border border-border/70 bg-background/90 shadow-soft backdrop-blur" />
        </div>,
        document.body,
      )
    : null

  return (
    <>
      {floatingLayer}
      <SessionRecorderDialog />
    </>
  )
}
