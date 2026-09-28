import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleDot } from 'lucide-react'
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
import { formatSessionRecorderClock } from './sessionRecorderFormat'
import {
  closeSessionRecorderDialog,
  deleteSelectedSessionRecorderHistory,
  getSelectedSessionRecorder,
  getSessionRecorderCopyText,
  openSessionRecorderDialog,
  recordSessionRecorderRoute,
  selectSessionRecorderHistory,
  startSessionRecording,
  stopSessionRecording,
  updateSelectedSessionRecorderNotes,
  updateSelectedSessionRecorderReport,
} from './sessionRecorderStore'
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

function fallbackPosition(width: number) {
  const inset = 12
  return {
    x: Math.max(inset, window.innerWidth - width - inset),
    y: inset,
  }
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
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    setCopied(false)
    setCopyFailed(false)
  }, [state.selectedId, state.dialogOpen])

  const handleCopy = async () => {
    const text = getSessionRecorderCopyText(selected)
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
          <DialogTitle>操作记录</DialogTitle>
          <DialogDescription>上方是这次的文本操作记录，下方可补充你碰到的问题。复制会带上两段。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">历史记录</span>
            <select
              aria-label="历史记录"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={state.selectedId ?? ''}
              onChange={(event) => selectSessionRecorderHistory(event.target.value)}
            >
              {state.history.length === 0 ? <option value="">还没有历史记录</option> : null}
              {state.history.map((session) => (
                <option key={session.id} value={session.id}>
                  {new Date(session.startedAt).toLocaleString('zh-CN')}
                  {session.notes.trim() ? ` · ${session.notes.trim().slice(0, 16)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">文本操作记录</span>
            <Textarea
              aria-label="文本操作记录"
              className="min-h-40 font-mono text-xs"
              value={selected?.reportText ?? ''}
              placeholder="还没有记录。点下方「开始录制」。"
              onChange={(event) => updateSelectedSessionRecorderReport(event.target.value)}
              disabled={!selected}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">额外补充</span>
            <Textarea
              aria-label="刚才碰到什么问题？（可选）"
              className="min-h-24"
              value={selected?.notes ?? ''}
              placeholder="刚才碰到什么问题？（可选）"
              onChange={(event) => updateSelectedSessionRecorderNotes(event.target.value)}
              disabled={!selected}
            />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!selected}
            onClick={() => deleteSelectedSessionRecorderHistory()}
          >
            删除
          </Button>
          <Button type="button" variant="outline" disabled={!selected} onClick={() => void handleCopy()}>
            {copied ? '已复制' : copyFailed ? '请手动复制' : '复制'}
          </Button>
          <Button type="button" onClick={() => startSessionRecording()}>
            开始录制
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SessionRecorderFloatingControl() {
  const state = useSessionRecorderState()
  const [now, setNow] = useState(() => Date.now())
  const [position, setPosition] = useState(() => fallbackPosition(36))
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

  useEffect(() => {
    if (!state.recording) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state.recording])

  useLayoutEffect(() => {
    if (dragged) return
    const sync = () => {
      if (draggedRef.current) return
      const width = rootRef.current?.offsetWidth ?? (state.recording ? 180 : 36)
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
  }, [dragged, state.recording])

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

  const elapsed = state.current
    ? formatSessionRecorderClock(now - Date.parse(state.current.startedAt))
    : '00:00'

  const openRecorder = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    openSessionRecorderDialog()
  }

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
    >
      {state.recording && state.current ? (
        <div className="flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 shadow-soft">
          <span className="size-2.5 shrink-0 rounded-full bg-destructive" aria-hidden />
          <span className="text-xs tabular-nums text-muted-foreground">录制中 {elapsed}</span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            data-session-recorder-control="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => stopSessionRecording()}
          >
            停止
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="录制"
          title="操作记录"
          onClick={openRecorder}
        >
          <CircleDot />
        </Button>
      )}
    </div>
  )

  if (typeof document === 'undefined') return layer
  return createPortal(layer, document.body)
}

export function SessionRecorderHost() {
  const location = useLocation()
  const state = useSessionRecorderState()

  useEffect(() => {
    if (!state.recording) return
    recordSessionRecorderRoute(`${location.pathname}${location.search}${location.hash}`)
  }, [location.hash, location.pathname, location.search, state.recording])

  return (
    <>
      <SessionRecorderFloatingControl />
      <SessionRecorderDialog />
    </>
  )
}
