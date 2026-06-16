import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorState,
  getLatestMindMapFrameProps,
  renderInRouter,
  setupMindMapReviewFlowTest,
} from "@/features/review/components/MindMapReviewFlow.test-support";
import { MindMapReviewFlow } from "@/features/review/components/MindMapReviewFlow";
import { REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY } from "@/features/review/reviewFeedbackSettings";

describe("MindMapReviewFlow feedback", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setupMindMapReviewFlowTest();
  });

  it("saves feedback volume from the feedback settings dialog", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "反馈设置" }));

    const volumeInput = screen.getByLabelText("音量") as HTMLInputElement;
    expect(volumeInput.value).toBe("1.5");
    expect(screen.getByText("150%")).toBeTruthy();

    fireEvent.change(volumeInput, { target: { value: "1.8" } });

    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY) || "{}",
      ) as Record<string, unknown>;
      expect(saved.volume).toBe(1.8);
    });
    expect(screen.getByText("180%")).toBeTruthy();
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

    expect(screen.getByText("可结算")).toBeTruthy();
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

    expect(screen.getByRole("status", { name: "连击 3" })).toBeTruthy();
    expect(screen.getAllByText("手感到了，继续揭晓。").length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "反馈设置" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(screen.queryByRole("status", { name: "连击 3" })).toBeNull();
    expect(screen.getByText("连击 3")).toBeTruthy();
    vi.useRealTimers();
  });
});
