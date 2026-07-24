import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUICK_SETTLE_HOLD_DELAY_MS,
  QuickSettleHoldButton,
} from "@/widgets/mindmap-review-flow/QuickSettleHoldButton";

const OPTION_NAMES = [
  "一键记为忘记并结算",
  "一键记为困难并结算",
  "一键记为记得并结算",
  "一键记为轻松并结算",
] as const;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** jsdom PointerEvent often drops clientX/Y via fireEvent; set them explicitly. */
function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: {
    pointerId: number;
    pointerType?: string;
    button?: number;
    clientX: number;
    clientY: number;
    isPrimary?: boolean;
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType ?? "mouse" },
    button: { value: init.button ?? 0 },
    buttons: { value: type === "pointerup" ? 0 : 1 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    isPrimary: { value: init.isPrimary ?? true },
  });
  target.dispatchEvent(event);
}

async function holdOpenMenu(settle: HTMLElement, pointerId = 1) {
  await act(async () => {
    dispatchPointer(settle, "pointerdown", {
      pointerId,
      pointerType: "mouse",
      button: 0,
      clientX: 230,
      clientY: 110,
      isPrimary: true,
    });
    vi.advanceTimersByTime(QUICK_SETTLE_HOLD_DELAY_MS + 20);
    vi.runOnlyPendingTimers();
  });
}

describe("QuickSettleHoldButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 0) as unknown as number;
    });

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const el = this as HTMLElement;
      const label = el.getAttribute("aria-label") ?? "";
      if (label === "完成" || label === "结算") {
        return rect(200, 100, 72, 32);
      }
      if (label === "快捷评分") {
        return rect(100, 50, 160, 36);
      }
      const optionIndex = OPTION_NAMES.indexOf(label as (typeof OPTION_NAMES)[number]);
      if (optionIndex >= 0) {
        return rect(100 + optionIndex * 40, 50, 40, 36);
      }
      return rect(0, 0, 0, 0);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("short click triggers normal complete without quick settle", () => {
    const onComplete = vi.fn();
    const onQuickSettle = vi.fn();
    render(
      <QuickSettleHoldButton onComplete={onComplete} onQuickSettle={onQuickSettle} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onQuickSettle).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "快捷评分" })).toBeNull();
  });

  it("hold reveals grades and release on 记 quick-settles with rating 3", async () => {
    const onComplete = vi.fn();
    const onQuickSettle = vi.fn();
    render(
      <QuickSettleHoldButton onComplete={onComplete} onQuickSettle={onQuickSettle} />,
    );

    const settle = screen.getByRole("button", { name: "完成" });
    await holdOpenMenu(settle, 1);

    expect(screen.getByRole("menu", { name: "快捷评分" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "一键记为记得并结算" })).toBeTruthy();

    // 记 column: left 180–220
    await act(async () => {
      dispatchPointer(window, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 190,
        clientY: 60,
      });
      dispatchPointer(window, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 190,
        clientY: 60,
      });
    });

    expect(onQuickSettle).toHaveBeenCalledTimes(1);
    expect(onQuickSettle).toHaveBeenCalledWith(3);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("release above the grade row cancels without settling", async () => {
    const onComplete = vi.fn();
    const onQuickSettle = vi.fn();
    render(
      <QuickSettleHoldButton onComplete={onComplete} onQuickSettle={onQuickSettle} />,
    );

    const settle = screen.getByRole("button", { name: "完成" });
    await holdOpenMenu(settle, 7);

    await act(async () => {
      dispatchPointer(window, "pointermove", {
        pointerId: 7,
        pointerType: "mouse",
        clientX: 190,
        clientY: 20,
      });
      dispatchPointer(window, "pointerup", {
        pointerId: 7,
        pointerType: "mouse",
        clientX: 190,
        clientY: 20,
      });
    });

    expect(screen.queryByRole("menu", { name: "快捷评分" })).toBeNull();
    expect(onQuickSettle).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
