import * as React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorState,
  renderInRouter,
  setupMindMapReviewFlowTest,
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
    resolveComplete();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onComplete).toHaveBeenCalledTimes(1);
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
  });

  it("calls restart once when restart is confirmed", async () => {
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
  });
});
