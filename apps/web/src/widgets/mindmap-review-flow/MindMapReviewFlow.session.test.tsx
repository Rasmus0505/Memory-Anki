import * as React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorState,
  renderInRouter,
  setupMindMapReviewFlowTest,
  timer,
  useTimedSessionMock,
} from "@/widgets/mindmap-review-flow/MindMapReviewFlow.test-support";
import { MindMapReviewFlow } from "@/widgets/mindmap-review-flow";

describe("MindMapReviewFlow session", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setupMindMapReviewFlowTest();
  });

  it("submits only once when completion is clicked rapidly", async () => {
    let resolveComplete: () => void = () => {};
    const onComplete = vi.fn(
      async (payload: { finalize: () => Promise<void> }) => {
        await new Promise<void>((resolve) => {
          resolveComplete = resolve;
        });
        await payload.finalize();
      },
    );

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    );

    const completeButton = screen.getByRole("button", { name: /完成/ });
    fireEvent.click(completeButton);
    fireEvent.click(completeButton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(timer.complete).not.toHaveBeenCalled();

    resolveComplete();
    await waitFor(() => expect(timer.complete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps freestyle quick-settle grades hidden until settle is held in compact chrome", async () => {
    const onQuickSettle = vi.fn(async (_rating, payload: { finalize: () => Promise<void> }) => {
      await payload.finalize();
    });
    const onComplete = vi.fn();

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        studySessionId="review-quick-1"
        reviewEditorState={editorState}
        chromeDensity="compact"
        onComplete={onComplete}
        onQuickSettle={onQuickSettle}
      />,
    );

    expect(screen.getByRole("button", { name: "AI 学习" })).toBeTruthy();
    // Grades are not always-on chrome; only the settle control remains.
    expect(screen.queryByRole("button", { name: "一键记为忘记并结算" })).toBeNull();
    expect(screen.queryByRole("button", { name: "一键记为困难并结算" })).toBeNull();
    expect(screen.queryByRole("button", { name: "一键记为记得并结算" })).toBeNull();
    expect(screen.queryByRole("button", { name: "一键记为轻松并结算" })).toBeNull();
    expect(screen.getByRole("button", { name: "完成" })).toBeTruthy();

    // Short click still uses the normal settlement path.
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onQuickSettle).not.toHaveBeenCalled();
  });

  it("keeps settlement and rating mode available after the first complete", async () => {
    const onComplete = vi.fn(async (payload: { finalize: () => Promise<void> }) => {
      await payload.finalize();
    });

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        studySessionId="review-amend-1"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /完成/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("本次已完成")).toBeTruthy());

    // Rating chrome stays available for undo/re-rate after settlement.
    expect(screen.getByRole("button", { name: "评分" })).toBeTruthy();

    // Wait until the completion ceremony releases the settle button.
    await waitFor(() => {
      const settle = screen.getByRole("button", { name: /完成/ }) as HTMLButtonElement;
      expect(settle.disabled).toBe(false);
    });

    // Settlement can be opened again to amend results.
    fireEvent.click(screen.getByRole("button", { name: /完成/ }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
  });

  it("requests final completion directly without an intermediate decision dialog", async () => {
    const onComplete = vi.fn();

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /完成/ }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /已完成/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /未完成/ })).toBeNull();
    expect(timer.pause).toHaveBeenCalledWith({ source: "completion_pending" });
  });

  it("disables local completion persistence for formal review sessions", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("frame-readonly-plain")).toBeTruthy();
    });
    expect(useTimedSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "review",
        persistCompletionRecord: false,
      }),
    );
  });

  it("starts formal review timing as soon as the active route is ready", async () => {
    (timer as { status: string }).status = "idle";
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        persistKey="review:1"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(timer.start).toHaveBeenCalledWith({ source: "review_route_ready" });
    });
  });

  it("skips duplicate local time persistence when completion was stored by the submit API", async () => {
    const onComplete = vi.fn(async (payload: { finalize: (options?: { persistTimeRecord?: boolean }) => Promise<void> }) => {
      await payload.finalize({ persistTimeRecord: false });
    });

    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /完成/ }));

    await waitFor(() => {
      expect(timer.complete).toHaveBeenCalledWith(
        "manual_complete",
        expect.objectContaining({ revealed_remaining: true }),
        { persistRecord: false },
      );
    });
  });

  it("starts practice timing as soon as the active route is ready", async () => {
    (timer as { status: string }).status = "idle";
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        persistKey="practice:palace:1"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(timer.start).toHaveBeenCalledWith({ source: "review_route_ready" });
    });
  });

  it("resets completed timing only after restart is confirmed", async () => {
    const onRestart = vi.fn(async () => true);
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onRestart={onRestart}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));

    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1));
    expect(timer.reset).toHaveBeenCalledTimes(1);
    expect(timer.registerActivity).toHaveBeenCalledWith("practice_interaction", { source: "restart" });
  });

});
