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
} from "@/features/review/components/MindMapReviewFlow.test-support";
import { MindMapReviewFlow } from "@/features/review/components/MindMapReviewFlow";

describe("MindMapReviewFlow session", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setupMindMapReviewFlowTest();
  });

  it("submits only once when completion is clicked rapidly", async () => {
    let resolveComplete: () => void = () => {};
    const onComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve;
        }),
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
    expect(timer.complete).toHaveBeenCalledTimes(1);

    resolveComplete();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("maps completion decision shortcuts to unfinished and completed feedback", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);

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
    expect(timer.complete).toHaveBeenCalledWith(
      "manual_complete",
      expect.objectContaining({
        revealed_remaining: true,
        red_marked_count: 2,
      }),
    );
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
});
