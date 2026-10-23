import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { GripHorizontal } from 'lucide-react'
import { applyMaskDrag, type MaskDragMode, type MaskRect } from '../dictationLayout'

type ResizeDirection = Exclude<MaskDragMode, 'move'>
type DragMode = MaskDragMode

interface DragState {
  mode: DragMode
  startX: number
  startY: number
  rect: MaskRect
  width: number
  height: number
}

interface DictationMaskProps {
  rect: MaskRect
  blur: number
  opacity: number
  isPlaying: boolean
  onChange: (rect: MaskRect) => void
  onCommit: (rect: MaskRect) => void
}

const HANDLES: ResizeDirection[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function DictationMask({
  rect,
  blur,
  opacity,
  isPlaying,
  onChange,
  onCommit,
}: DictationMaskProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const latestRectRef = useRef(rect)
  latestRectRef.current = rect

  useEffect(() => {
    return () => {
      dragRef.current = null
    }
  }, [])

  const beginDrag = (event: ReactPointerEvent, mode: DragMode) => {
    const container = containerRef.current
    if (!container) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = container.getBoundingClientRect()
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect: latestRectRef.current,
      width: bounds.width,
      height: bounds.height,
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const next = applyMaskDrag(
        drag.rect,
        drag.mode,
        ((moveEvent.clientX - drag.startX) / Math.max(1, drag.width)) * 100,
        ((moveEvent.clientY - drag.startY) / Math.max(1, drag.height)) * 100,
      )
      latestRectRef.current = next
      onChange(next)
    }
    const handleUp = () => {
      const drag = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      if (drag) onCommit(latestRectRef.current)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  return (
    <div ref={containerRef} className="ed-mask-layer" aria-hidden={false}>
      <div
        role="group"
        aria-label="视频遮挡板，可拖动并缩放"
        data-testid="english-dictation-mask"
        className="ed-mask"
        data-playing={isPlaying ? 'true' : 'false'}
        style={{
          left: `${rect.x}%`,
          top: `${rect.y}%`,
          width: `${rect.w}%`,
          height: `${rect.h}%`,
          background: isPlaying
            ? `rgba(10, 8, 6, ${Math.min(0.97, Math.max(0.72, opacity / 100))})`
            : `rgba(10, 8, 6, ${Math.min(0.96, Math.max(0.25, opacity / 100))})`,
          backdropFilter: isPlaying ? 'none' : `blur(${blur}px)`,
          WebkitBackdropFilter: isPlaying ? 'none' : `blur(${blur}px)`,
        }}
        onPointerDown={(event) => beginDrag(event, 'move')}
      >
        <div className="ed-mask__grain" aria-hidden />
        <div className="ed-mask__grip" aria-hidden>
          <GripHorizontal className="size-4" />
          <span>遮挡板</span>
        </div>
        {HANDLES.map((direction) => (
          <span
            key={direction}
            className={`ed-mask__handle ed-mask__handle--${direction}`}
            data-testid={`english-mask-handle-${direction}`}
            onPointerDown={(event) => beginDrag(event, direction)}
          />
        ))}
      </div>
    </div>
  )
}
