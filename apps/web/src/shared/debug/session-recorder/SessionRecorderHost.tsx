import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleDot, TriangleAlert } from 'lucide-react'
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
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import {
  closeSessionRecorderDialog,
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
import { DIAGNOSIS_WINDOW_OPTIONS_MINUTES, type DiagnosisWindowMinutes } from './sessionRecorderBrief'
import { useSessionRecorderState } from './useSessionRecorderState'

export const SESSION_RECORDER_ANCHOR_ATTR = 'data-session-recorder-anchor'
export const SESSION_RECORDER_LAYER_ZCLASS = 'z-[20000]'
const DRAG_CLICK_THRESHOLD_PX = 4

function readAnchorPosition() {
  const anchor = document.querySelector(`[${SESSION_RECORDER_ANCHOR_ATTR}="true"]`)
  if (!(anchor instanceof HTMLElement)) return null
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { x: rect.left, y: rect.top }
}

// Used when the desktop sidebar anchor is hidden (PWA / narrow screens): sit at the top-right of the phone's sticky top bar,
// level with the back/forward pill on the left and below the notch / status bar.
const RECORDER_FALLBACK_WIDTH_PX = 36

function fallbackPosition(width = RECORDER_FALLBACK_WIDTH_PX) {
  const inset = 8
  return { x: Math.max(0, window.innerWidth - width - inset), y: inset + readSafeAreaTop() }
}

// JS cannot read env() directly, so measure the top safe-area inset through a probe element.
function readSafeAreaTop() {
  if (typeof document === 'undefined' || !document.body) return 0
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)'
  document.body.appendChild(probe)
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return inset
}

function clampPosition(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(0, window.innerWidth - width)
  const maxY = Math.max(0, window.innerHeight - height)
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
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

function SessionRecorderFloatingControl() {
  const [position, setPosition] = useState(() => fallbackPosition())
  const [dragged, setDragged] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef(position)
  const draggedRef = useRef(false)
  const suppressClickRef = useRef(false)
  positionRef.current = position
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  useLayoutEffect(() => {
    if (dragged) return
    const sync = () => {
      if (draggedRef.current) return
      const width = rootRef.current?.offsetWidth ?? 36
      const height = rootRef.current?.offsetHeight ?? 36
      const anchored = readAnchorPosition() ?? fallbackPosition(width)
      const next = clampPosition(anchored.x, anchored.y, width, height)
      setPosition((current) => (current.x === next.x && current.y === next.y ? current : next))
    }
    sync()
    window.addEventListener('resize', sync)
    const anchor = document.querySelector(`[${SESSION_RECORDER_ANCHOR_ATTR}="true"]`)
    const observed = anchor instanceof Element ? anchor.closest('aside') ?? anchor : null
    const observer = observed ? new ResizeObserver(sync) : null
    if (observed) observer?.observe(observed)
    return () => {
      window.removeEventListener('resize', sync)
      observer?.disconnect()
    }
  }, [dragged])

  useEffect(() => {
    const handleDown = (event: PointerEvent) => {
      const node = rootRef.current
      const target = event.target instanceof Element ? event.target : null
      if (!node || !target || !node.contains(target)) return
      if (target.closest('[data-session-recorder-control="true"]')) return
      suppressClickRef.current = false
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: positionRef.current.x,
        originY: positionRef.current.y,
      }
    }
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const node = rootRef.current
      if (!drag || !node || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
      if (
        Math.abs(event.clientX - drag.startX) > DRAG_CLICK_THRESHOLD_PX ||
        Math.abs(event.clientY - drag.startY) > DRAG_CLICK_THRESHOLD_PX
      ) {
        suppressClickRef.current = true
        draggedRef.current = true
        setDragged(true)
      }
      setPosition(
        clampPosition(
          drag.originX + event.clientX - drag.startX,
          drag.originY + event.clientY - drag.startY,
          node.offsetWidth,
          node.offsetHeight,
        ),
      )
    }
    const handleUp = () => {
      dragRef.current = null
    }
    window.addEventListener('pointerdown', handleDown)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointerdown', handleDown)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [pickerOpen, setPickerOpen] = useState(false)
  const resetTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const togglePicker = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setPickerOpen((open) => !open)
  }

  const copyRecent = async (minutes: DiagnosisWindowMinutes) => {
    setPickerOpen(false)
    const ok = await copyRecentBriefToClipboard(minutes)
    setCopyState(ok ? 'copied' : 'failed')
    if (!ok) openSessionRecorderDialog()
    if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 2500)
  }

  const openLeft = typeof window !== 'undefined' && position.x > window.innerWidth / 2
  const layer = (
    <div
      ref={rootRef}
      className={cn(
        'pointer-events-auto fixed cursor-grab touch-none select-none active:cursor-grabbing',
        SESSION_RECORDER_LAYER_ZCLASS,
      )}
      style={{ left: position.x, top: position.y }}
      data-session-recorder="true"
      data-session-recorder-hud="true"
      title="拖动可移动"
      onContextMenu={(event) => {
        event.preventDefault()
        openSessionRecorderDialog()
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="录制"
        aria-expanded={pickerOpen}
        title="点一下选择复制最近几分钟的操作和报错，直接粘贴给 AI（右键可查看和补充说明）"
        onClick={togglePicker}
      >
        {copyState === 'copied' ? <Check className="text-emerald-500" /> : copyState === 'failed' ? <TriangleAlert className="text-amber-500" /> : <CircleDot />}
      </Button>
      {pickerOpen ? (
        <div
          role="menu"
          aria-label="选择复制的时长"
          className={cn(
            'absolute top-0 flex flex-col gap-1 rounded-md border bg-background p-1 shadow',
            // Open toward the screen's centre so a top-right recorder never pushes the menu off-screen.
            openLeft ? 'right-full mr-2' : 'left-full ml-2',
          )}
        >
          {DIAGNOSIS_WINDOW_OPTIONS_MINUTES.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              aria-label={`复制最近 ${minutes} 分钟`}
              className="justify-start whitespace-nowrap"
              onClick={() => void copyRecent(minutes)}
            >
              最近 {minutes} 分钟
            </Button>
          ))}
        </div>
      ) : null}
      {copyState !== 'idle' && !pickerOpen ? (
        <span
          role="status"
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow',
            openLeft ? 'right-full mr-2' : 'left-full ml-2',
          )}
        >
          {copyState === 'copied' ? '已复制，去粘贴给 AI' : '复制失败，请在弹窗里手动复制'}
        </span>
      ) : null}
    </div>
  )

  if (typeof document === 'undefined') return layer
  return createPortal(layer, document.body)
}

export function SessionRecorderHost() {
  const location = useLocation()

  useEffect(() => {
    ensureSessionRecorderCapture()
  }, [])

  useEffect(() => {
    recordSessionRecorderRoute(`${location.pathname}${location.search}${location.hash}`)
  }, [location.hash, location.pathname, location.search])

  return (
    <>
      <SessionRecorderFloatingControl />
      <SessionRecorderDialog />
    </>
  )
}
