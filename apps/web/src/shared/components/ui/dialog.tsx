import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type PropsWithChildren,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

type DialogLayout = 'centered' | 'unstyled'
type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw'

interface FloatingDialogLayout {
  x: number
  y: number
  width: number
  height: number | null
  collapsed: boolean
  pinned: boolean
}

const FLOATING_DIALOG_STORAGE_PREFIX = 'memory-anki-floating-dialog:'
const FLOATING_DIALOG_MIN_WIDTH = 320
const FLOATING_DIALOG_MIN_HEIGHT = 180
const FLOATING_DIALOG_VIEWPORT_PADDING = 16

const resizeHandleStyles: Record<ResizeDirection, { className: string; label: string }> = {
  n: { className: 'left-6 right-6 top-[-6px] h-3 cursor-ns-resize', label: '从上边调整弹窗大小' },
  e: { className: 'bottom-6 right-[-6px] top-6 w-3 cursor-ew-resize', label: '从右边调整弹窗大小' },
  s: { className: 'bottom-[-6px] left-6 right-6 h-3 cursor-ns-resize', label: '从下边调整弹窗大小' },
  w: { className: 'bottom-6 left-[-6px] top-6 w-3 cursor-ew-resize', label: '从左边调整弹窗大小' },
  nw: { className: 'left-[-6px] top-[-6px] h-6 w-6 cursor-nwse-resize', label: '从左上角调整弹窗大小' },
  ne: { className: 'right-[-6px] top-[-6px] h-6 w-6 cursor-nesw-resize', label: '从右上角调整弹窗大小' },
  se: { className: 'bottom-[-6px] right-[-6px] h-6 w-6 cursor-nwse-resize', label: '从右下角调整弹窗大小' },
  sw: { className: 'bottom-[-6px] left-[-6px] h-6 w-6 cursor-nesw-resize', label: '从左下角调整弹窗大小' },
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768 }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

function clampLayout(layout: FloatingDialogLayout): FloatingDialogLayout {
  const viewport = getViewportSize()
  const maxWidth = Math.max(FLOATING_DIALOG_MIN_WIDTH, viewport.width - FLOATING_DIALOG_VIEWPORT_PADDING * 2)
  const maxHeight = Math.max(FLOATING_DIALOG_MIN_HEIGHT, viewport.height - FLOATING_DIALOG_VIEWPORT_PADDING * 2)
  const width = Math.min(Math.max(layout.width, FLOATING_DIALOG_MIN_WIDTH), maxWidth)
  const height = layout.height == null ? null : Math.min(Math.max(layout.height, FLOATING_DIALOG_MIN_HEIGHT), maxHeight)
  const effectiveHeight = height ?? Math.min(560, maxHeight)

  return {
    ...layout,
    width,
    height,
    x: Math.min(Math.max(layout.x, FLOATING_DIALOG_VIEWPORT_PADDING), viewport.width - width - FLOATING_DIALOG_VIEWPORT_PADDING),
    y: Math.min(Math.max(layout.y, FLOATING_DIALOG_VIEWPORT_PADDING), viewport.height - effectiveHeight - FLOATING_DIALOG_VIEWPORT_PADDING),
  }
}

function createDefaultFloatingLayout(): FloatingDialogLayout {
  const viewport = getViewportSize()
  const width = Math.min(820, Math.max(FLOATING_DIALOG_MIN_WIDTH, viewport.width - 32))
  return clampLayout({
    x: Math.max(FLOATING_DIALOG_VIEWPORT_PADDING, Math.round((viewport.width - width) / 2)),
    y: Math.max(FLOATING_DIALOG_VIEWPORT_PADDING, Math.round(viewport.height * 0.08)),
    width,
    height: null,
    collapsed: false,
    pinned: false,
  })
}

function readStoredFloatingLayout(storageKey: string): FloatingDialogLayout {
  if (typeof window === 'undefined') return createDefaultFloatingLayout()
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return createDefaultFloatingLayout()
    const parsed = JSON.parse(raw) as Partial<FloatingDialogLayout>
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number'
    ) {
      return createDefaultFloatingLayout()
    }
    return clampLayout({
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: typeof parsed.height === 'number' ? parsed.height : null,
      collapsed: Boolean(parsed.collapsed),
      pinned: Boolean(parsed.pinned),
    })
  } catch {
    return createDefaultFloatingLayout()
  }
}

function writeStoredFloatingLayout(storageKey: string, layout: FloatingDialogLayout) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout))
  } catch {
    // 本地偏好写入失败不应影响弹窗使用。
  }
}

const DialogModalContext = createContext<{ modal: boolean }>({ modal: true })
const DialogTitleTextContext = createContext<((title: string) => void) | null>(null)

/**
 * 基于 Radix UI 的 Dialog 实现。
 *
 * 保持与旧自研版本完全一致的简化 API（Dialog / DialogContent / DialogHeader /
 * DialogTitle / DialogDescription / DialogFooter / DialogClose），调用方无需改动，
 * 同时获得开箱即用的无障碍能力：role=dialog、aria-modal、focus trap、焦点恢复、滚动锁定。
 *
 * `modal` prop 控制模态行为（与旧版一致，默认 true）。非模态（modal={false}）用于
 * 导入抽屉等需要背景交互的场景：不渲染遮罩、不锁定背景。
 */
function Dialog({
  open,
  onOpenChange,
  children,
  modal = true,
  className: _className,
}: PropsWithChildren<{
  open: boolean
  onOpenChange: (open: boolean) => void
  modal?: boolean
  className?: string
}>) {
  return (
    <DialogModalContext.Provider value={{ modal }}>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
        {children}
      </DialogPrimitive.Root>
    </DialogModalContext.Provider>
  )
}

const DialogContent = forwardRef<
  HTMLDivElement,
  PropsWithChildren<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>> & {
    layout?: DialogLayout
    showCloseButton?: boolean
    floating?: boolean
    floatingId?: string
    capsuleLabel?: string
  }
>(function DialogContent(
  {
    children,
    className,
    layout,
    showCloseButton = false,
    floating,
    floatingId,
    capsuleLabel,
    onPointerDownOutside,
    onInteractOutside,
    onEscapeKeyDown,
    ...props
  },
  ref,
) {
  const { modal } = useContext(DialogModalContext)
  const resolvedLayout = layout ?? (modal ? 'centered' : 'unstyled')
  const floatingEnabled = floating ?? resolvedLayout === 'centered'
  const stableFloatingId = useMemo(
    () => floatingId ?? `dialog:${capsuleLabel ?? String(props['aria-label'] ?? className ?? 'default')}`,
    [capsuleLabel, className, floatingId, props],
  )
  const storageKey = `${FLOATING_DIALOG_STORAGE_PREFIX}${stableFloatingId}`
  const [floatingLayout, setFloatingLayout] = useState<FloatingDialogLayout>(() =>
    readStoredFloatingLayout(storageKey),
  )
  const [derivedCapsuleLabel, setDerivedCapsuleLabel] = useState(capsuleLabel ?? '弹窗')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<
    | {
        type: 'drag'
        startX: number
        startY: number
        originX: number
        originY: number
      }
    | {
        type: 'resize'
        direction: ResizeDirection
        startX: number
        startY: number
        originX: number
        originY: number
        originWidth: number
        originHeight: number
      }
    | null
  >(null)

  const persistFloatingLayout = useCallback(
    (next: FloatingDialogLayout | ((current: FloatingDialogLayout) => FloatingDialogLayout)) => {
      setFloatingLayout((current) => {
        const resolved = clampLayout(typeof next === 'function' ? next(current) : next)
        writeStoredFloatingLayout(storageKey, resolved)
        return resolved
      })
    },
    [storageKey],
  )

  useEffect(() => {
    if (!floatingEnabled) return
    setFloatingLayout(readStoredFloatingLayout(storageKey))
  }, [floatingEnabled, storageKey])

  useEffect(() => {
    if (!floatingEnabled) return
    const handleResize = () => persistFloatingLayout((current) => current)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [floatingEnabled, persistFloatingLayout])

  useEffect(() => {
    if (!floatingEnabled) return
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current
      if (!interaction) return
      if (interaction.type === 'drag') {
        persistFloatingLayout((current) => ({
          ...current,
          x: interaction.originX + event.clientX - interaction.startX,
          y: interaction.originY + event.clientY - interaction.startY,
        }))
        return
      }

      const deltaX = event.clientX - interaction.startX
      const deltaY = event.clientY - interaction.startY
      let nextX = interaction.originX
      let nextY = interaction.originY
      let nextWidth = interaction.originWidth
      let nextHeight = interaction.originHeight

      if (interaction.direction.includes('e')) nextWidth = interaction.originWidth + deltaX
      if (interaction.direction.includes('s')) nextHeight = interaction.originHeight + deltaY
      if (interaction.direction.includes('w')) {
        nextWidth = interaction.originWidth - deltaX
        nextX = interaction.originX + deltaX
      }
      if (interaction.direction.includes('n')) {
        nextHeight = interaction.originHeight - deltaY
        nextY = interaction.originY + deltaY
      }

      persistFloatingLayout((current) => ({
        ...current,
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
      }))
    }

    const handlePointerUp = () => {
      interactionRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [floatingEnabled, persistFloatingLayout])

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!floatingEnabled) return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('button,a,input,textarea,select,[role="button"],[data-dialog-window-control="true"]')
      ) {
        return
      }
      interactionRef.current = {
        type: 'drag',
        startX: event.clientX,
        startY: event.clientY,
        originX: floatingLayout.x,
        originY: floatingLayout.y,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [floatingEnabled, floatingLayout.x, floatingLayout.y],
  )

  const beginResize = useCallback(
    (direction: ResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
      const rect = contentRef.current?.getBoundingClientRect()
      if (!rect) return
      interactionRef.current = {
        type: 'resize',
        direction,
        startX: event.clientX,
        startY: event.clientY,
        originX: floatingLayout.x,
        originY: floatingLayout.y,
        originWidth: rect.width,
        originHeight: rect.height,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.stopPropagation()
    },
    [floatingLayout.x, floatingLayout.y],
  )

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  const panelClassName = cn(
    'pointer-events-auto relative flex flex-col overflow-hidden',
    resolvedLayout === 'unstyled' && !floatingEnabled && 'z-[241]',
    resolvedLayout === 'centered' &&
      'max-h-[92vh] w-full max-w-3xl rounded-2xl border bg-background shadow-2xl',
    floatingEnabled && 'fixed max-w-none touch-none',
    floatingLayout.pinned && 'ring-2 ring-primary/30',
    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
    className,
  )

  if (floatingEnabled && floatingLayout.collapsed) {
    return (
      <DialogPrimitive.Portal>
        {modal ? (
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-[240] bg-black/45',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            )}
          />
        ) : null}
        <DialogPrimitive.Content
          ref={mergedRef}
          {...props}
          onPointerDownOutside={(event) => {
            if (floatingLayout.pinned) event.preventDefault()
            onPointerDownOutside?.(event)
          }}
          onInteractOutside={(event) => {
            if (floatingLayout.pinned) event.preventDefault()
            onInteractOutside?.(event)
          }}
          onEscapeKeyDown={onEscapeKeyDown}
          className="fixed z-[255] pointer-events-auto"
          style={{ left: floatingLayout.x, top: floatingLayout.y }}
        >
          <DialogPrimitive.Title className="sr-only">{derivedCapsuleLabel}</DialogPrimitive.Title>
          <button
            type="button"
            className="inline-flex max-w-[min(360px,calc(100vw-32px))] cursor-grab items-center gap-2 rounded-full border border-border/80 bg-background/96 px-4 py-2 text-sm font-medium shadow-2xl backdrop-blur active:cursor-grabbing"
            onPointerDown={beginDrag}
            onClick={() => persistFloatingLayout((current) => ({ ...current, collapsed: false }))}
            aria-label={`恢复${derivedCapsuleLabel}`}
          >
            <Maximize2 className="h-4 w-4 text-primary" />
            <span className="truncate">{derivedCapsuleLabel}</span>
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )
  }

  const content = (
    <DialogPrimitive.Content
      ref={mergedRef}
      {...props}
      onPointerDownOutside={(event) => {
        if (floatingLayout.pinned) event.preventDefault()
        onPointerDownOutside?.(event)
      }}
      onInteractOutside={(event) => {
        if (floatingLayout.pinned) event.preventDefault()
        onInteractOutside?.(event)
      }}
      onEscapeKeyDown={onEscapeKeyDown}
      className={panelClassName}
      style={
        floatingEnabled
          ? {
              ...props.style,
              left: floatingLayout.x,
              top: floatingLayout.y,
              width: floatingLayout.width,
              height: floatingLayout.height ?? props.style?.height,
              maxHeight: `calc(100vh - ${FLOATING_DIALOG_VIEWPORT_PADDING * 2}px)`,
              zIndex: floatingLayout.pinned ? 255 : 241,
            }
          : props.style
      }
    >
      {floatingEnabled ? (
        <div
          className="absolute inset-x-0 top-0 z-10 h-12 cursor-move"
          aria-hidden="true"
          onPointerDown={beginDrag}
        />
      ) : null}
      <DialogTitleTextContext.Provider
        value={(title) => {
          if (!capsuleLabel && title.trim()) setDerivedCapsuleLabel(title.trim())
        }}
      >
        {children}
      </DialogTitleTextContext.Provider>
      {floatingEnabled ? (
        <div
          className="absolute right-3 top-3 z-20 flex items-center gap-1"
          data-dialog-window-control="true"
        >
          <button
            type="button"
            className={cn(
              'rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
              floatingLayout.pinned && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
            )}
            aria-label={floatingLayout.pinned ? '取消置顶弹窗' : '置顶弹窗'}
            title={floatingLayout.pinned ? '取消置顶' : '置顶'}
            onClick={() => persistFloatingLayout((current) => ({ ...current, pinned: !current.pinned }))}
          >
            {floatingLayout.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="缩小为胶囊"
            title="缩小为胶囊"
            onClick={() => persistFloatingLayout((current) => ({ ...current, collapsed: true }))}
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {showCloseButton ? (
        <DialogPrimitive.Close
          className={cn(
            'absolute top-4 rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
            floatingEnabled ? 'right-24 z-20' : 'right-4',
          )}
          aria-label="关闭弹窗"
          data-dialog-window-control="true"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      ) : null}
      {floatingEnabled
        ? (Object.entries(resizeHandleStyles) as Array<[ResizeDirection, { className: string; label: string }]>).map(
            ([direction, handle]) => (
              <button
                key={direction}
                type="button"
                aria-label={handle.label}
                className={cn(
                  'absolute z-30 border-0 bg-transparent p-0 shadow-none before:content-none hover:shadow-none active:shadow-none',
                  handle.className,
                )}
                data-dialog-window-control="true"
                onPointerDown={(event) => beginResize(direction, event)}
              />
            ),
          )
        : null}
    </DialogPrimitive.Content>
  )

  return (
    <DialogPrimitive.Portal>
      {modal ? (
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[240] bg-black/45',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
      ) : null}
      {resolvedLayout === 'centered' && !floatingEnabled ? (
        <div className="fixed inset-0 z-[241] flex items-center justify-center p-4 pointer-events-none">
          {content}
        </div>
      ) : (
        content
      )}
    </DialogPrimitive.Portal>
  )
})

function DialogHeader({ children }: PropsWithChildren) {
  return (
    <div className="flex cursor-move items-start justify-between gap-4 border-b px-6 py-4 pr-28">
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function DialogTitle({ children, className }: PropsWithChildren<{ className?: string }>) {
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const setDialogTitleText = useContext(DialogTitleTextContext)

  useLayoutEffect(() => {
    const title = titleRef.current?.textContent?.trim()
    if (title) setDialogTitleText?.(title)
  }, [children, setDialogTitleText])

  return (
    <DialogPrimitive.Title asChild>
      <h2 ref={titleRef} data-dialog-title="true" className={cn('text-lg font-semibold', className)}>{children}</h2>
    </DialogPrimitive.Title>
  )
}

function DialogDescription({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <DialogPrimitive.Description asChild>
      <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>
    </DialogPrimitive.Description>
  )
}

function DialogFooter({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('flex items-center justify-end gap-3 border-t px-6 py-4', className)}>
      {children}
    </div>
  )
}

function DialogClose({
  onClick,
  className,
}: {
  onClick?: () => void
  className?: string
}) {
  return (
    <DialogPrimitive.Close
      onClick={onClick}
      className={cn(
        'rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        className,
      )}
      aria-label="关闭弹窗"
      data-dialog-window-control="true"
    >
      <X className="h-4 w-4" />
    </DialogPrimitive.Close>
  )
}

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
}
