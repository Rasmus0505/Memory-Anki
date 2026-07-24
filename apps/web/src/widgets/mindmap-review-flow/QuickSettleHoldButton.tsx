import { SquareCheckBig } from "lucide-react";
import * as React from "react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import type { MindMapRecallRating } from "@/shared/api/contracts";

export const QUICK_SETTLE_HOLD_DELAY_MS = 420;
export const QUICK_SETTLE_OPTIONS: Array<{
  rating: MindMapRecallRating;
  label: string;
  title: string;
  variant: "destructive" | "outline" | "default" | "secondary";
}> = [
  { rating: 1, label: "忘", title: "一键记为忘记并结算", variant: "destructive" },
  { rating: 2, label: "难", title: "一键记为困难并结算", variant: "outline" },
  { rating: 3, label: "记", title: "一键记为记得并结算", variant: "default" },
  { rating: 4, label: "轻", title: "一键记为轻松并结算", variant: "secondary" },
];

type HoverTarget = MindMapRecallRating | "cancel" | null;

export interface QuickSettleHoldButtonProps {
  disabled?: boolean;
  allClearReady?: boolean;
  className?: string;
  onComplete: () => void;
  onQuickSettle: (rating: MindMapRecallRating) => void;
}

/**
 * Compact freestyle settle control:
 * - short click → normal settlement dialog path
 * - hold (mouse left / finger) → floating 忘/难/记/轻 above the button
 * - while holding, slide L/R to pick a grade; slide above the row to cancel
 */
export function QuickSettleHoldButton({
  disabled = false,
  allClearReady = false,
  className,
  onComplete,
  onQuickSettle,
}: QuickSettleHoldButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const optionsStripRef = React.useRef<HTMLDivElement | null>(null);
  const optionRefs = React.useRef<Partial<Record<MindMapRecallRating, HTMLButtonElement | null>>>({});

  const holdTimerRef = React.useRef<number | null>(null);
  const activePointerIdRef = React.useRef<number | null>(null);
  const menuOpenRef = React.useRef(false);
  const suppressClickRef = React.useRef(false);
  const pointerClientRef = React.useRef<{ x: number; y: number } | null>(null);
  const finishedPointerRef = React.useRef<number | null>(null);

  const [gestureActive, setGestureActive] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [hoverTarget, setHoverTarget] = React.useState<HoverTarget>(null);
  const [menuPos, setMenuPos] = React.useState<{ left: number; top: number } | null>(null);

  const clearHoldTimer = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const closeMenu = React.useCallback(() => {
    menuOpenRef.current = false;
    setMenuOpen(false);
    setMenuPos(null);
    setHoverTarget(null);
  }, []);

  const endGesture = React.useCallback(() => {
    clearHoldTimer();
    activePointerIdRef.current = null;
    pointerClientRef.current = null;
    setGestureActive(false);
  }, [clearHoldTimer]);

  const resolveHoverTarget = React.useCallback((clientX: number, clientY: number): HoverTarget => {
    const strip = optionsStripRef.current;
    if (!strip) return null;
    const stripRect = strip.getBoundingClientRect();

    // Slide above the four grade buttons → cancel.
    if (clientY < stripRect.top) {
      return "cancel";
    }

    for (const option of QUICK_SETTLE_OPTIONS) {
      const el = optionRefs.current[option.rating];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top - 6 &&
        clientY <= rect.bottom + 10
      ) {
        return option.rating;
      }
    }

    // Horizontal scrub while the pointer stays in the option band.
    if (clientY >= stripRect.top - 2 && clientY <= stripRect.bottom + 12) {
      const width = Math.max(stripRect.width, 1);
      const ratio = (clientX - stripRect.left) / width;
      if (ratio < 0 || ratio > 1) return null;
      const index = Math.min(3, Math.max(0, Math.floor(ratio * QUICK_SETTLE_OPTIONS.length)));
      return QUICK_SETTLE_OPTIONS[index]!.rating;
    }

    return null;
  }, []);

  const placeMenu = React.useCallback(() => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button) return;
    const btnRect = button.getBoundingClientRect();
    const panelWidth = panel?.offsetWidth ?? 176;
    const panelHeight = panel?.offsetHeight ?? 56;
    const left = Math.min(
      Math.max(8, btnRect.right - panelWidth),
      window.innerWidth - panelWidth - 8,
    );
    const top = Math.max(8, btnRect.top - panelHeight - 8);
    setMenuPos({ left, top });
  }, []);

  const openMenuAtButton = React.useCallback(() => {
    placeMenu();
    menuOpenRef.current = true;
    setMenuOpen(true);
    suppressClickRef.current = true;
    try {
      navigator.vibrate?.(28);
    } catch {
      // Optional haptic.
    }

    window.requestAnimationFrame(() => {
      placeMenu();
      const pointer = pointerClientRef.current;
      if (pointer) {
        setHoverTarget(resolveHoverTarget(pointer.x, pointer.y));
      }
    });
  }, [placeMenu, resolveHoverTarget]);

  const readPointer = React.useCallback((clientX?: number, clientY?: number) => {
    const fallback = pointerClientRef.current;
    const x = typeof clientX === "number" && Number.isFinite(clientX) ? clientX : fallback?.x;
    const y = typeof clientY === "number" && Number.isFinite(clientY) ? clientY : fallback?.y;
    if (typeof x !== "number" || typeof y !== "number") return null;
    return { x, y };
  }, []);

  const finishMenuGesture = React.useCallback(
    (clientX?: number, clientY?: number) => {
      if (!menuOpenRef.current) {
        endGesture();
        closeMenu();
        return;
      }
      const point = readPointer(clientX, clientY);
      const target = point ? resolveHoverTarget(point.x, point.y) : null;
      endGesture();
      closeMenu();
      if (target && target !== "cancel") {
        onQuickSettle(target);
      }
    },
    [closeMenu, endGesture, onQuickSettle, readPointer, resolveHoverTarget],
  );

  React.useEffect(() => {
    if (!gestureActive) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      if (typeof event.clientX === "number" && typeof event.clientY === "number") {
        pointerClientRef.current = { x: event.clientX, y: event.clientY };
      }
      if (!menuOpenRef.current) return;
      event.preventDefault();
      const point = pointerClientRef.current;
      if (!point) return;
      setHoverTarget(resolveHoverTarget(point.x, point.y));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      // Button handler may already finish; avoid double commit.
      if (finishedPointerRef.current === event.pointerId) {
        finishedPointerRef.current = null;
        return;
      }
      if (menuOpenRef.current) {
        finishMenuGesture(event.clientX, event.clientY);
        return;
      }
      // Short press path is handled on the button (click / touch pointerup).
      endGesture();
    };

    const onCancel = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      endGesture();
      closeMenu();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [closeMenu, endGesture, finishMenuGesture, gestureActive, resolveHoverTarget]);

  React.useEffect(() => {
    return () => {
      clearHoldTimer();
    };
  }, [clearHoldTimer]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (event.isPrimary === false) return;

    clearHoldTimer();
    suppressClickRef.current = false;
    finishedPointerRef.current = null;
    closeMenu();
    activePointerIdRef.current = event.pointerId;
    pointerClientRef.current = { x: event.clientX, y: event.clientY };
    setGestureActive(true);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // JSDOM / older engines may not support capture.
    }

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      if (activePointerIdRef.current !== event.pointerId) return;
      openMenuAtButton();
    }, QUICK_SETTLE_HOLD_DELAY_MS);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }

    if (menuOpenRef.current) {
      finishedPointerRef.current = event.pointerId;
      finishMenuGesture(event.clientX, event.clientY);
      return;
    }

    const hadTimer = holdTimerRef.current !== null;
    clearHoldTimer();
    endGesture();

    if (hadTimer && !suppressClickRef.current && !disabled) {
      // Mouse: native click follows. Touch/pen: complete here (click may not fire).
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        suppressClickRef.current = true;
        onComplete();
      }
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }
    if (disabled) return;
    onComplete();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (menuOpenRef.current || suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const label = allClearReady ? "结算" : "完成";
  const cancelActive = hoverTarget === "cancel";

  return (
    <div className="relative shrink-0">
      <Button
        ref={buttonRef}
        type="button"
        size="sm"
        disabled={disabled}
        className={cn(
          "h-9 shrink-0 touch-none px-3 text-xs sm:h-8 sm:px-2.5",
          menuOpen && "ring-2 ring-primary/40",
          className,
        )}
        title="点击结算 · 长按快捷评分（上滑取消）"
        aria-label={label}
        aria-haspopup={true}
        aria-expanded={menuOpen}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => {
          if (activePointerIdRef.current !== event.pointerId) return;
          endGesture();
          closeMenu();
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <SquareCheckBig className="mr-1 size-3.5" />
        {label}
      </Button>

      {menuOpen && menuPos ? (
        <div
          ref={panelRef}
          className="fixed z-[220] flex flex-col items-center gap-1 pointer-events-none select-none"
          style={{ left: menuPos.left, top: menuPos.top }}
        >
          <div
            className={cn(
              "flex h-5 items-center rounded-full px-2 text-[10px] font-medium transition-opacity",
              cancelActive
                ? "bg-muted text-muted-foreground opacity-100"
                : "opacity-0",
            )}
            aria-hidden={!cancelActive}
          >
            松手取消
          </div>
          <div
            ref={optionsStripRef}
            role="menu"
            aria-label="快捷评分"
            className={cn(
              "flex items-center gap-1 rounded-full border border-border/70 bg-card/95 p-1 shadow-lg backdrop-blur-md",
              cancelActive && "opacity-55",
            )}
          >
            {QUICK_SETTLE_OPTIONS.map((option) => {
              const active = hoverTarget === option.rating;
              return (
                <Button
                  key={option.rating}
                  ref={(node) => {
                    optionRefs.current[option.rating] = node;
                  }}
                  type="button"
                  size="sm"
                  variant={option.variant}
                  role="menuitem"
                  tabIndex={-1}
                  title={option.title}
                  aria-label={option.title}
                  aria-selected={active}
                  className={cn(
                    "h-9 min-w-9 shrink-0 px-2 text-[12px] font-semibold transition-transform sm:h-8 sm:min-w-8",
                    active && "scale-110 ring-2 ring-offset-1 ring-offset-background ring-primary",
                  )}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
