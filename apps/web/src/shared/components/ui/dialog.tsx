import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
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
  type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { playUiSound } from '@/shared/feedback/uiSounds'
import {
  applyRememberedFloatingSize,
  clampLayout,
  createCenteredFloatingLayout,
  FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH,
  FLOATING_DIALOG_MIN_WIDTH,
  FLOATING_DIALOG_STORAGE_PREFIX,
  FLOATING_DIALOG_VIEWPORT_PADDING,
  hasRememberedFloatingSize,
  inferWidthFromClassName,
  readStoredFloatingLayout,
  shouldDeferDialogToCenteredLayout,
  writeStoredFloatingLayout,
  type FloatingDialogLayout,
  type FloatingDialogRemember,
} from './dialogFloatingLayout'
import { CLIENT_PREFERENCES_UPDATED_EVENT } from '@/shared/preferences/clientPreferences'
import { onAppEvent } from '@/shared/events/appEvents'
import { flushWindowLayoutRemotePersist } from '@/shared/preferences/windowLayoutMemory'

type DialogLayout = 'centered' | 'unstyled'
type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw'

function isCoarsePointerViewport() {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024
}

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

const DialogModalContext = createContext<{ modal: boolean; open: boolean }>({ modal: true, open: false })
const DialogTitleTextContext = createContext<((title: string) => void) | null>(null)
const DialogDragHandleContext = createContext<
  ((event: ReactPointerEvent<HTMLElement>) => void) | null
>(null)

function containsDialogPart(
  children: ReactNode,
  part: typeof DialogTitle | typeof DialogDescription,
): boolean {
  let found = false
  Children.forEach(children, (child) => {
    if (found || !isValidElement(child)) return
    if (child.type === part) {
      found = true
      return
    }
    const childProps = child.props as { children?: ReactNode }
    if (childProps.children) found = containsDialogPart(childProps.children, part)
  })
  return found
}

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
}: PropsWithChildren<{
  open: boolean
  onOpenChange: (open: boolean) => void
  modal?: boolean
}>) {
  return (
    <DialogModalContext.Provider value={{ modal, open }}>
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
    defaultWidth?: number
    expandOnOpen?: boolean
    dismissOnInteractOutside?: boolean
    capsuleLabel?: string
    accessibleTitle?: string
    accessibleDescription?: string
  }
>(function DialogContent(
  {
    children,
    className,
    layout,
    showCloseButton = false,
    floating,
    floatingId,
    defaultWidth,
    expandOnOpen = false,
    dismissOnInteractOutside = true,
    capsuleLabel,
    accessibleTitle,
    accessibleDescription,
    onPointerDownOutside,
    onInteractOutside,
    onEscapeKeyDown,
    ...props
  },
  ref,
) {
  const { modal, open } = useContext(DialogModalContext)
  useEffect(() => {
    // Content mounts on open; wait out the opening button's tap.
    const id = window.setTimeout(() => playUiSound('swish'), 60)
    return () => window.clearTimeout(id)
  }, [])
  const resolvedLayout = layout ?? (modal ? 'centered' : 'unstyled')
  // Only an *explicit* width request can disqualify a dialog from floating; the
  // 820px fallback is a default, not a demand, and a plain dialog must keep
  // floating on narrow viewports (where 820 exceeds the clamp but nothing else
  // goes wrong).
  const explicitRequestedWidth = defaultWidth ?? inferWidthFromClassName(className)
  const inferredDefaultWidth = explicitRequestedWidth ?? FLOATING_DIALOG_LEGACY_DEFAULT_WIDTH
  // The floating panel is placed at absolute pixels, so it cannot express a
  // viewport-relative width. A dialog asking for `w-[min(92vw,1440px)]` or
  // `max-w-[min(94vw,1220px)]` is wider than any fixed floating box: clamping it
  // to the floating cap left real panels narrower than their own content, and the
  // remembered pixel position then stranded them off-center. Those dialogs keep
  // the centered layout, which honors the class and is always centered.
  const deferredToCentered = floating !== false
    && shouldDeferDialogToCenteredLayout({ className, requestedWidth: explicitRequestedWidth })
  const floatingEnabled = (floating ?? resolvedLayout === 'centered')
    && !deferredToCentered
    && !isCoarsePointerViewport()
  const stableFloatingId = useMemo(
    () => floatingId ?? `dialog:${capsuleLabel ?? String(props['aria-label'] ?? className ?? 'default')}`,
    [capsuleLabel, className, floatingId, props],
  )
  const hasDialogTitle = containsDialogPart(children, DialogTitle)
  const hasDialogDescription = containsDialogPart(children, DialogDescription)
  const hasExplicitDescription = Object.prototype.hasOwnProperty.call(props, 'aria-describedby')
  const contentProps =
    !hasDialogDescription && !accessibleDescription && !hasExplicitDescription
      ? { ...props, 'aria-describedby': undefined }
      : props
  const fallbackTitle = accessibleTitle ?? capsuleLabel ?? String(props['aria-label'] ?? '弹窗')
  const storageKey = `${FLOATING_DIALOG_STORAGE_PREFIX}${stableFloatingId}`
  const [floatingLayout, setFloatingLayout] = useState<FloatingDialogLayout>(() =>
    readStoredFloatingLayout(storageKey, inferredDefaultWidth),
  )
  const [derivedCapsuleLabel, setDerivedCapsuleLabel] = useState(capsuleLabel ?? '弹窗')
  const contentRef = useRef<HTMLDivElement | null>(null)
  // Guards the mount-time measurement in `mergedRef` so it runs once per open.
  const mountMeasuredRef = useRef(false)
  // Once the user drags/resizes the panel, stop auto-centering it for this open.
  const autoCenterLockedRef = useRef(false)
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
    (
      next: FloatingDialogLayout | ((current: FloatingDialogLayout) => FloatingDialogLayout),
      remember: FloatingDialogRemember = {},
    ) => {
      setFloatingLayout((current) => {
        const resolved = clampLayout(typeof next === 'function' ? next(current) : next)
        writeStoredFloatingLayout(storageKey, resolved, remember)
        return resolved
      })
    },
    [storageKey],
  )

  useEffect(() => {
    if (!floatingEnabled) return
    setFloatingLayout(readStoredFloatingLayout(storageKey, inferredDefaultWidth))
  }, [floatingEnabled, inferredDefaultWidth, storageKey])

  // Each open: re-center using the real box so max-w-* dialogs are not left-biased.
  useLayoutEffect(() => {
    if (!open || !floatingEnabled) return
    autoCenterLockedRef.current = false
    // Radix renders the panel through a portal that is not in the DOM yet when this
    // layout effect runs, so `contentRef.current` is null on the first pass and the
    // real box cannot be measured here. The ref callback (`mergedRef`) re-runs the
    // centering pass the moment the node mounts, which is what actually measures
    // the panel; this pass still handles re-opens where the node is already live.
    const node = contentRef.current
    // Layout metrics (offsetWidth/offsetHeight) ignore the open/close zoom
    // transform. getBoundingClientRect() reports the shrunken entrance frame
    // (zoom-in-95 => scale(0.95)), which under-measures the panel and pushes a
    // centered dialog below the true vertical center and past the bottom edge.
    const measuredWidth = node ? Math.round(node.offsetWidth) : 0
    const measuredHeight = node ? Math.round(node.offsetHeight) : 0
    setFloatingLayout((current) => {
      const remembered = hasRememberedFloatingSize(storageKey)
        ? readStoredFloatingLayout(storageKey, inferredDefaultWidth)
        : null
      const width = remembered
        ? remembered.width
        : (measuredWidth >= FLOATING_DIALOG_MIN_WIDTH ? measuredWidth : current.width)
      const next = createCenteredFloatingLayout({
        width,
        height: remembered ? remembered.height : current.height,
        measuredHeight,
        collapsed: expandOnOpen ? false : (remembered?.collapsed ?? current.collapsed),
        pinned: remembered?.pinned ?? current.pinned,
      })
      writeStoredFloatingLayout(storageKey, next, { size: !remembered, position: true })
      return next
    })
  }, [expandOnOpen, floatingEnabled, inferredDefaultWidth, open, storageKey])

  // The panel is often taller than its first layout frame (async content, web
  // fonts, images, expanded sections). Keep re-centering on content resize until
  // the user drags/resizes it, so a centered dialog never settles below center
  // or past the bottom edge as it grows.
  useEffect(() => {
    if (!open || !floatingEnabled || floatingLayout.collapsed) return
    const node = contentRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    // The layout effect above runs before the portal has mounted the panel, so it
    // cannot measure the real box and centers against the 400px auto-height. This
    // first observer callback is the first frame where a real measurement exists,
    // so apply it rather than skipping it: otherwise a tall dialog stays centered
    // as if it were 400px high, sitting below true center.
    const observer = new ResizeObserver(() => {
      if (autoCenterLockedRef.current || interactionRef.current) return
      const width = Math.round(node.offsetWidth)
      const height = Math.round(node.offsetHeight)
      if (!(width > 0) || !(height > 0)) return
      setFloatingLayout((current) => {
        const next = createCenteredFloatingLayout({
          width: width >= FLOATING_DIALOG_MIN_WIDTH ? width : current.width,
          height: current.height,
          measuredHeight: height,
          collapsed: current.collapsed,
          pinned: current.pinned,
        })
        if (
          next.x === current.x && next.y === current.y
          && next.width === current.width && next.height === current.height
        ) {
          return current
        }
        return next
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [floatingEnabled, floatingLayout.collapsed, open])

  useEffect(() => {
    if (!open || !floatingEnabled || !expandOnOpen) return
    persistFloatingLayout((current) =>
      current.collapsed ? { ...current, collapsed: false } : current,
    )
  }, [expandOnOpen, floatingEnabled, open, persistFloatingLayout])

  useEffect(() => {
    if (!floatingEnabled) return
    const handleResize = () => {
      if (interactionRef.current) return
      setFloatingLayout((current) => applyRememberedFloatingSize(storageKey, current))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [floatingEnabled, storageKey])

  useEffect(() => {
    if (!floatingEnabled) return
    return onAppEvent(CLIENT_PREFERENCES_UPDATED_EVENT, (detail) => {
      if (!detail || !Object.prototype.hasOwnProperty.call(detail, 'window_layouts')) return
      if (interactionRef.current) return
      setFloatingLayout((current) => (
        open ? applyRememberedFloatingSize(storageKey, current) : readStoredFloatingLayout(storageKey, inferredDefaultWidth)
      ))
    })
  }, [floatingEnabled, inferredDefaultWidth, open, storageKey])

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
        }), { position: true })
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
      }), { position: true, size: true })
    }

    const handlePointerUp = () => {
      if (interactionRef.current) flushWindowLayoutRemotePersist()
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
      const allowControlDrag = event.currentTarget.hasAttribute('data-dialog-capsule-drag')
      if (
        !allowControlDrag &&
        target instanceof Element &&
        target.closest('button,a,input,textarea,select,[role="button"],[data-dialog-window-control="true"]')
      ) {
        return
      }
      autoCenterLockedRef.current = true
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
      autoCenterLockedRef.current = true
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

  // Latest centering inputs for the mount-time measurement in `mergedRef`. Keeping
  // them in a ref lets the callback stay identity-stable, which matters because the
  // ref re-fires whenever it changes and would otherwise loop against setState.
  const mountCenterInputsRef = useRef({ floatingEnabled, open, inferredDefaultWidth, storageKey })
  mountCenterInputsRef.current = { floatingEnabled, open, inferredDefaultWidth, storageKey }

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      const {
        floatingEnabled: enabled,
        open: isOpen,
        inferredDefaultWidth: defaultWidth,
        storageKey: key,
      } = mountCenterInputsRef.current
      if (node && isOpen && enabled && !autoCenterLockedRef.current && !mountMeasuredRef.current) {
        // First frame where the portal is actually mounted, so this is the earliest
        // point at which the real box can be measured. Without it the panel would
        // keep the auto-height centering (as if it were 400px tall) and sit below
        // true center. offsetHeight/offsetWidth ignore the open zoom transform,
        // which getBoundingClientRect() would report shrunken.
        const width = Math.round(node.offsetWidth)
        const height = Math.round(node.offsetHeight)
        if (height > 0) {
          mountMeasuredRef.current = true
          setFloatingLayout((current) => {
            const remembered = hasRememberedFloatingSize(key)
              ? readStoredFloatingLayout(key, defaultWidth)
              : null
            const next = createCenteredFloatingLayout({
              width: remembered
                ? remembered.width
                : (width >= FLOATING_DIALOG_MIN_WIDTH ? width : current.width),
              height: remembered ? remembered.height : current.height,
              measuredHeight: height,
              collapsed: current.collapsed,
              pinned: current.pinned,
            })
            writeStoredFloatingLayout(key, next, { size: !remembered, position: true })
            return next
          })
        }
      }
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  const panelClassName = cn(
    'pointer-events-auto',
    (resolvedLayout !== 'unstyled' || floatingEnabled) && 'relative flex flex-col overflow-hidden',
    resolvedLayout === 'unstyled' && !floatingEnabled && 'z-[241]',
    resolvedLayout === 'centered' &&
      'max-h-[92vh] w-full max-w-3xl rounded-lg border bg-background shadow-floating',
    floatingLayout.pinned && 'ring-2 ring-primary/30',
    'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
    'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
    className,
    floatingEnabled && 'fixed max-w-none touch-none',
  )

  if (floatingEnabled && floatingLayout.collapsed && !(open && expandOnOpen)) {
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
          aria-describedby={undefined}
          onPointerDownOutside={(event) => {
            if (!dismissOnInteractOutside) event.preventDefault()
            if (floatingLayout.pinned) event.preventDefault()
            onPointerDownOutside?.(event)
          }}
          onInteractOutside={(event) => {
            if (!dismissOnInteractOutside) event.preventDefault()
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
            className="inline-flex max-w-[min(360px,calc(100vw-32px))] cursor-grab items-center gap-2 rounded-full border border-border/80 bg-background/96 px-4 py-2 text-sm font-medium shadow-popover backdrop-blur active:cursor-grabbing"
            data-dialog-capsule-drag="true"
            onPointerDown={beginDrag}
            onClick={() => {
              persistFloatingLayout((current) => ({ ...current, collapsed: false }))
              flushWindowLayoutRemotePersist()
            }}
            aria-label={`恢复${derivedCapsuleLabel}`}
          >
            <Maximize2 className="size-4 text-primary" />
            <span className="truncate">{derivedCapsuleLabel}</span>
          </button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )
  }

  const content = (
    <DialogPrimitive.Content
      ref={mergedRef}
      data-dialog-content-panel="true"
      {...contentProps}
      onPointerDownOutside={(event) => {
        if (!dismissOnInteractOutside) event.preventDefault()
        if (floatingLayout.pinned) event.preventDefault()
        onPointerDownOutside?.(event)
      }}
      onInteractOutside={(event) => {
        if (!dismissOnInteractOutside) event.preventDefault()
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
      <DialogDragHandleContext.Provider value={floatingEnabled ? beginDrag : null}>
        <DialogTitleTextContext.Provider
          value={(title) => {
            if (!capsuleLabel && title.trim()) setDerivedCapsuleLabel(title.trim())
          }}
        >
          {hasDialogTitle ? null : (
            <DialogPrimitive.Title className="sr-only">{fallbackTitle}</DialogPrimitive.Title>
          )}
          {!hasDialogDescription && accessibleDescription ? (
            <DialogPrimitive.Description className="sr-only">
              {accessibleDescription}
            </DialogPrimitive.Description>
          ) : null}
          {children}
        </DialogTitleTextContext.Provider>
      </DialogDragHandleContext.Provider>
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
            onClick={() => {
              persistFloatingLayout((current) => ({ ...current, pinned: !current.pinned }))
              flushWindowLayoutRemotePersist()
            }}
          >
            {floatingLayout.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="缩小为胶囊"
            title="缩小为胶囊"
            onClick={() => {
              persistFloatingLayout((current) => ({ ...current, collapsed: true }))
              flushWindowLayoutRemotePersist()
            }}
          >
            <Minimize2 className="size-4" />
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
          <X className="size-4" />
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

function DialogBody({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-auto px-5 py-3', className)}>
      {children}
    </div>
  )
}

function DialogHeader({ children }: PropsWithChildren) {
  const beginDrag = useContext(DialogDragHandleContext)
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b px-5 py-3 pr-24',
        beginDrag ? 'cursor-move' : '',
      )}
      onPointerDown={beginDrag ?? undefined}
    >
      <div className="flex flex-col gap-1">{children}</div>
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
      <h2 ref={titleRef} data-dialog-title="true" className={cn('text-base font-semibold tracking-tight', className)}>{children}</h2>
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
    <div className={cn('flex items-center justify-end gap-2 border-t px-5 py-3', className)}>
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
      <X className="size-4" />
    </DialogPrimitive.Close>
  )
}

export {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
}
