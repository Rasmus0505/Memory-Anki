import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorState,
  getLatestMindMapFrameProps,
  renderInRouter,
  setupMindMapReviewFlowTest,
} from "@/features/review/components/MindMapReviewFlow.test-support";
import { MindMapReviewFlow } from "@/features/review/components/MindMapReviewFlow";
import { writeReviewFeedbackSettings } from "@/shared/feedback/reviewFeedbackSettings";
describe("MindMapReviewFlow feedback", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setupMindMapReviewFlowTest();
  });

  it("removes inline feedback controls from the review flow header", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.queryByText("沉浸反馈")).toBeNull();
    expect(screen.queryByRole("button", { name: "一键降噪" })).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复沉浸" })).toBeNull();
    expect(screen.queryByRole("button", { name: "反馈设置" })).toBeNull();
  });

  it("highlights completion readiness when all non-root nodes are revealed", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([
        { uid: "grandchild", text: "Grandchild" },
      ]);
    });

    expect(screen.getByText("可攻克全域")).toBeTruthy();
    expect(screen.getByRole("button", { name: "完成结算" })).toBeTruthy();
  });

  it("shows a short completion ceremony before invoking onComplete", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn().mockResolvedValue(undefined);

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /完成/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /已完成/ }));
    });

    expect(screen.getByText("通关结算中")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(850);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("dismisses the combo milestone burst on time even if the parent rerenders repeatedly", async () => {
    vi.useFakeTimers();
    writeReviewFeedbackSettings({
      visualStyle: 'warm_playful',
      reducedCelebrationMotion: false,
      scenes: {
        review: { enabled: true, soundEnabled: true, animationEnabled: true, confettiAmount: 0.55, cooldownMs: 0 },
        milestone: { enabled: true, soundEnabled: true, animationEnabled: true, confettiAmount: 1.6, cooldownMs: 0, steps: [2, 4, 6, 10, 15] },
        completion: { enabled: true, soundEnabled: true, animationEnabled: true, confettiAmount: 1.6, cooldownMs: 0 },
        timer: { enabled: true, soundEnabled: true, animationEnabled: true, confettiAmount: 2.2, cooldownMs: 12000 },
        quiz: { enabled: true, soundEnabled: true, animationEnabled: true, confettiAmount: 0.8, cooldownMs: 0 },
      },
      mode: "immersive",
      soundEnabled: true,
      volume: 1.5,
      baseVolumeMultiplier: 1,
      confettiAmount: 1.6,
      animationEnabled: true,
      surpriseEnabled: true,
      soundTheme: "classic",
      globalIntensity: "balanced",
      celebration: {
        globalCooldownMs: 0,
        milestone: {
          enabled: true,
          steps: [2, 4, 6, 10, 15],
          cooldownMs: 0,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: true,
        },
        branchClear: {
          enabled: true,
          cooldownMs: 0,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: true,
        },
        allClearReady: {
          enabled: true,
          cooldownMs: 0,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: true,
        },
        sessionComplete: {
          enabled: true,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: true,
        },
      },
    });
    const comboEditorState = {
      editor_doc: {
        root: {
          data: { text: "Root", uid: "root" },
          children: [
            { data: { text: "Child A", uid: "child-a" }, children: [] },
            { data: { text: "Child B", uid: "child-b" }, children: [] },
            { data: { text: "Child C", uid: "child-c" }, children: [] },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: "zh",
    };

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={comboEditorState}
        onComplete={vi.fn()}
      />,
    );

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([
        { uid: "child-a", text: "Child A" },
      ]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([
        { uid: "child-b", text: "Child B" },
      ]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([
        { uid: "child-c", text: "Child C" },
      ]);
    });

    expect(screen.getByRole("status", { name: "推进链 2" })).toBeTruthy();
    expect(screen.getAllByText("起势成功，继续爆裂揭示。").length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(screen.getByText("推进链 3")).toBeTruthy();
    vi.useRealTimers();
  });
});
