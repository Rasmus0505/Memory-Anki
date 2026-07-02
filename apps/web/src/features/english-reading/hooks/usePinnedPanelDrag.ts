import { useEffect } from "react";
import type { MutableRefObject } from "react";

export interface PinnedPanelDragState {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
}

export function usePinnedPanelDrag({
  active,
  dragRef,
  onMove,
  onStop,
}: {
  active: boolean;
  dragRef: MutableRefObject<PinnedPanelDragState | null>;
  onMove: (clientX: number, clientY: number, dragState: PinnedPanelDragState) => void;
  onStop: () => void;
}) {
  useEffect(() => {
    if (!active) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      onMove(event.clientX, event.clientY, dragState);
    };
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== -1) return;
      onMove(event.clientX, event.clientY, dragState);
    };
    const stopDragging = (event?: PointerEvent | MouseEvent) => {
      const dragState = dragRef.current;
      if (!dragState) return;
      if (
        typeof PointerEvent !== "undefined" &&
        event instanceof PointerEvent &&
        event.pointerId !== dragState.pointerId
      ) {
        return;
      }
      dragRef.current = null;
      document.body.style.userSelect = "";
      onStop();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      document.body.style.userSelect = "";
      dragRef.current = null;
    };
  }, [active, dragRef, onMove, onStop]);
}
