import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
export const SESSION_RECORDER_FLOATING_POSITION_KEY = 'memory-anki.session-recorder.floating-position.v1'

type FloatingPosition = { left: number; top: number }
type FloatingDrag = {
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  moved: boolean
}

function readFloatingPosition(): FloatingPosition | null {
  try {
    const raw = window.localStorage.getItem(SESSION_RECORDER_FLOATING_POSITION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<FloatingPosition>
    return Number.isFinite(value.left) && Number.isFinite(value.top)
      ? { left: value.left as number, top: value.top as number }
      : null
  } catch {
    return null
  }
}

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
  open,
  onOpenChange,
}: {
  /** Extra items appended below the recorder actions. */
  children?: ReactNode
  side?: 'top' | 'bottom' | 'right'
  align?: 'start' | 'end'
  triggerClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
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
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="录制"
          title="调试工具：复制最近几分钟的操作给 AI、查看日志"
          className={triggerClassName}
          onPointerDown={open !== undefined ? (event) => event.preventDefault() : undefined}
          onClick={open !== undefined ? () => onOpenChange?.(!open) : undefined}
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
  const floatingRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<FloatingDrag | null>(null)
  const suppressClickRef = useRef(false)
  const suppressResetRef = useRef<number | null>(null)
  const pendingPositionRef = useRef<FloatingPosition | null>(null)
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    ensureSessionRecorderCapture()
  }, [])

  useEffect(() => {
    if (!floating) return
    const restorePosition = () => {
      const stored = readFloatingPosition()
      const element = floatingRef.current
      if (!stored || !element) return
      const width = element.offsetWidth || 36
      const height = element.offsetHeight || 36
      const next = {
        left: Math.min(Math.max(8, window.innerWidth - width - 8), Math.max(8, stored.left)),
        top: Math.min(Math.max(8, window.innerHeight - height - 8), Math.max(8, stored.top)),
      }
      pendingPositionRef.current = next
      setFloatingPosition(next)
    }
    restorePosition()
    window.addEventListener('resize', restorePosition)
    return () => window.removeEventListener('resize', restorePosition)
  }, [floating])

  useEffect(() => () => {
    if (suppressResetRef.current != null) window.clearTimeout(suppressResetRef.current)
  }, [])

  const onFloatingPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node) || event.button !== 0) return
    event.preventDefault()
    if (menuOpen) return
    suppressClickRef.current = false
    if (suppressResetRef.current != null) window.clearTimeout(suppressResetRef.current)
    const bounds = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      moved: false,
    }
    try {
      event.currentTarget.querySelector('button')?.setPointerCapture?.(event.pointerId)
    } catch {
      // 合成事件或不支持捕获的浏览器仍可继续处理区域内的手势。
    }
  }

  const onFloatingPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true
    const element = floatingRef.current
    if (!element) return
    const maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8)
    const maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8)
    const left = Math.min(maxLeft, Math.max(8, event.clientX - drag.offsetX))
    const top = Math.min(maxTop, Math.max(8, event.clientY - drag.offsetY))
    const next = { left, top }
    setFloatingPosition(next)
    pendingPositionRef.current = next
  }

  const onFloatingPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.moved) {
      const next = pendingPositionRef.current
      if (next) {
        try {
          window.localStorage.setItem(SESSION_RECORDER_FLOATING_POSITION_KEY, JSON.stringify(next))
        } catch {
          // 存储不可用时仍保留本次访问的拖动位置。
        }
      }
      suppressClickRef.current = true
      if (suppressResetRef.current != null) window.clearTimeout(suppressResetRef.current)
      suppressResetRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressResetRef.current = null
      }, 400)
    }
  }

  useEffect(() => {
    recordSessionRecorderRoute(location.pathname)
  }, [location.pathname])

  const floatingLayer = floating && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={floatingRef}
          className={cn(
            'pointer-events-auto fixed touch-none md:hidden',
            SESSION_RECORDER_LAYER_ZCLASS,
          )}
          style={floatingPosition
            ? { left: floatingPosition.left, top: floatingPosition.top }
            : { right: 8, top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
          onPointerDownCapture={onFloatingPointerDown}
          onPointerMove={onFloatingPointerMove}
          onPointerUp={onFloatingPointerUp}
          onPointerCancel={onFloatingPointerUp}
          onLostPointerCapture={onFloatingPointerUp}
          onClickCapture={(event) => {
            if (!event.currentTarget.contains(event.target as Node)) return
            if (suppressClickRef.current) {
              event.preventDefault()
              event.stopPropagation()
              suppressClickRef.current = false
              if (suppressResetRef.current != null) window.clearTimeout(suppressResetRef.current)
              suppressResetRef.current = null
            }
          }}
          data-session-recorder="true"
          data-session-recorder-hud="true"
        >
          <SessionRecorderMenu
            side="bottom"
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            triggerClassName="size-9 rounded-full border border-border/70 bg-background/90 shadow-soft backdrop-blur"
          />
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
