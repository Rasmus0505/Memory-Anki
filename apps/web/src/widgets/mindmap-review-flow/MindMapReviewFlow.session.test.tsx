import * as React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorState,
  persistStudySessionRecordMock,
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

    const completedButton = screen.getByRole("button", { name: /已完成/ });
    fireEvent.click(completedButton);
    fireEvent.click(completedButton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(timer.complete).not.toHaveBeenCalled();

    resolveComplete();
    await waitFor(() => expect(timer.complete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("maps completion decision shortcuts to unfinished and completed feedback", async () => {
    const onComplete = vi.fn(async (payload: { finalize: () => Promise<void> }) => {
      await payload.finalize();
    });

    const { unmount } = renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /完成/ }));
    fireEvent.keyDown(window, { key: "1", code: "Digit1" });

    await waitFor(() => {
      expect(timer.complete).toHaveBeenCalledWith(
        "saved",
        expect.objectContaining({
          revealed_remaining: false,
          red_marked_count: 0,
        }),
      );
    });
    expect(onComplete).not.toHaveBeenCalled();

    unmount();
    setupMindMapReviewFlowTest();

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
    fireEvent.keyDown(window, { key: "5", code: "Digit5" });

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(timer.complete).toHaveBeenCalledWith(
        "manual_complete",
        expect.objectContaining({
          revealed_remaining: true,
          red_marked_count: 2,
        }),
      );
    });
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

  it("records time when a formal review session is marked unfinished", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /完成/ }));
    fireEvent.click(screen.getByRole("button", { name: /未完成/ }));

    await waitFor(() => {
      expect(timer.complete).toHaveBeenCalledWith(
        "saved",
        expect.objectContaining({
          revealed_remaining: false,
          red_marked_count: 0,
        }),
      );
    });
    expect(persistStudySessionRecordMock).toHaveBeenCalledTimes(1);
    expect(timer.reset).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole("button", { name: /已完成/ }));

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

});
