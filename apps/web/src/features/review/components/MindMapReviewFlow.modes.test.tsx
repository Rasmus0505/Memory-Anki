import * as React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editEditorState,
  editorState,
  getLatestMindMapFrameProps,
  getVisibleTextsFromLatestFrame,
  openQuizLauncherMock,
  renderInRouter,
  setupMindMapReviewFlowTest,
  timer,
} from "@/features/review/components/MindMapReviewFlow.test-support";
import { MindMapReviewFlow } from "@/features/review/components/MindMapReviewFlow";

describe("MindMapReviewFlow modes", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setupMindMapReviewFlowTest();
  });

  it("uses shared toolbar controls while keeping the host frame readonly in review mode", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="review"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "全屏导图" })).toBeNull();
    expect(screen.getByText("frame-readonly-plain")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "搜索" })).toBeNull();
    expect(screen.getByRole("button", { name: "做题" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "做题" }));
    expect(openQuizLauncherMock).toHaveBeenCalledWith(
      expect.objectContaining({
        palaceId: 1,
        scene: "review",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "宿主半屏切换" }));
    await waitFor(() => {
      expect(screen.getByText("frame-readonly-immersive")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "退出原生全屏" }));
    await waitFor(() => {
      expect(screen.getByText("frame-readonly-immersive")).toBeTruthy();
    });

    const latestCall = getLatestMindMapFrameProps();
    expect(latestCall?.readonly).toBe(true);
    expect(latestCall?.syncIntent).toBe("soft");
    expect(latestCall?.syncReason).toBe("review_flip");
    expect(latestCall?.preserveViewOnSync).toBe(true);
    expect(latestCall?.mobileViewPolicy).toBe("auto");
    expect(latestCall?.nodeClickViewportPolicy).toBe("preserve");
  });

  it("shows a mobile guided review rail without moving the viewport during card navigation", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Root").length).toBeGreaterThan(0);

    expect(
      (screen.getByRole("button", { name: "下一个" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "揭示" }));
    });

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "待回忆",
        grandchild: null,
      });
    });
    expect(
      (screen.getByRole("button", { name: "下一个" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    });

    await waitFor(() => {
      expect(screen.getAllByText("待回忆").length).toBeGreaterThan(0);
      expect(getLatestMindMapFrameProps()?.focusRequestNodeUid).toBeUndefined();
      expect(getLatestMindMapFrameProps()?.focusRequestNonce).toBeUndefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "上级" }));
    });

    await waitFor(() => {
      expect(screen.getAllByText("Root").length).toBeGreaterThan(0);
      expect(getLatestMindMapFrameProps()?.focusRequestNodeUid).toBeUndefined();
      expect(getLatestMindMapFrameProps()?.focusRequestNonce).toBeUndefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "全局" }));
    });

    await waitFor(() => {
      expect(screen.getAllByText("Root").length).toBeGreaterThan(0);
    });
  });

  it("switches review flow into inline edit mode with a return-to-review label and hides completion", async () => {
    function Harness() {
      const [displayMode, setDisplayMode] = React.useState<"review" | "edit">(
        "review",
      );
      const [modeSyncVersion, setModeSyncVersion] = React.useState(0);
      const [nextEditorState, setNextEditorState] = React.useState(editorState);
      return (
        <MindMapReviewFlow
          title="Root"
          palaceId={1}
          sessionKind="review"
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={`review-session:1:${displayMode}`}
          reviewEditorState={nextEditorState}
          editEditorState={editEditorState}
          onModeToggle={() => {
            setDisplayMode((current) => (current === "review" ? "edit" : "review"));
            setModeSyncVersion((current) => current + 1);
          }}
          onEditEditorStateChange={(nextState) =>
            setNextEditorState(nextState as typeof editorState)
          }
          onComplete={vi.fn()}
        />
      );
    }

    renderInRouter(<Harness />);

    expect(screen.getByText("frame-readonly-plain")).toBeTruthy();
    expect(screen.getByRole("button", { name: /完成/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    await waitFor(() => {
      expect(screen.getByText("frame-editable-plain")).toBeTruthy();
      expect(screen.getByRole("button", { name: "复习" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /完成/ })).toBeNull();
    expect(timer.logEvent).toHaveBeenCalledWith("enter_edit_mode", {
      source: "review_inline_edit",
    });
    expect(timer.registerActivity).toHaveBeenCalledWith("edit_operation", {
      source: "review_inline_edit_enter",
    });

    fireEvent.click(screen.getByRole("button", { name: "复习" }));

    await waitFor(() => {
      expect(screen.getByText("frame-readonly-plain")).toBeTruthy();
      expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /完成/ })).toBeTruthy();
    expect(timer.logEvent).toHaveBeenCalledWith("exit_edit_mode", {
      source: "review_inline_edit",
    });
    expect(timer.registerActivity).toHaveBeenCalledWith("practice_interaction", {
      source: "review_inline_edit_exit",
    });
  });

  it("keeps reveal progress by node uid after editing and switching back to review mode", async () => {
    function Harness() {
      const [displayMode, setDisplayMode] = React.useState<"review" | "edit">(
        "review",
      );
      const [modeSyncVersion, setModeSyncVersion] = React.useState(0);
      const [nextEditorState, setNextEditorState] = React.useState(editorState);
      return (
        <MindMapReviewFlow
          title="Root"
          palaceId={1}
          sessionKind="review"
          displayMode={displayMode}
          modeSyncVersion={modeSyncVersion}
          viewMemoryScope={`review-session:1:${displayMode}`}
          reviewEditorState={nextEditorState}
          editEditorState={nextEditorState}
          onModeToggle={() => {
            setDisplayMode((current) => (current === "review" ? "edit" : "review"));
            setModeSyncVersion((current) => current + 1);
          }}
          onEditEditorStateChange={(nextState) =>
            setNextEditorState(nextState as typeof editorState)
          }
          onComplete={vi.fn()}
        />
      );
    }

    renderInRouter(<Harness />);

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "Child",
      grandchild: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() => {
      expect(screen.getByText("frame-editable-plain")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "宿主编辑保存" }));
    await waitFor(() => {
      expect(timer.registerActivity).toHaveBeenCalledWith("edit_operation", {
        source: "review_inline_edit",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "复习" }));

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "Child edited",
        grandchild: null,
      });
    });
  });

  it("reveals placeholder and next hidden child through readonly left-click flow", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: null,
      grandchild: null,
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: "category_expand",
        nodeUid: "child",
        lineMode: "spawn",
      }),
    );
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "待回忆",
      grandchild: null,
    });
    expect(screen.getByText("推进链 0")).toBeTruthy();

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });
    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: "card_reveal",
        nodeUid: "child",
        lineMode: "confirm",
      }),
    );
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "Child",
      grandchild: null,
    });
    expect(screen.getByText("推进链 1")).toBeTruthy();

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });
    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: "next_level_expand",
        nodeUid: "child",
        lineMode: "spawn",
      }),
    );
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "Child",
      grandchild: "待回忆",
    });

    expect(timer.registerActivity).toHaveBeenCalledWith("practice_interaction", {
      source: "left_click",
    });
  });

  it("uses Space to advance the currently selected review node without firing inside inputs", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText("Space / 1-5")).toBeTruthy();
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: null,
      grandchild: null,
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeActive?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: " ", code: "Space" });
    });

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "待回忆",
      grandchild: null,
    });
    expect(timer.registerActivity).toHaveBeenCalledWith("practice_interaction", {
      source: "left_click",
    });

    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      await act(async () => {
        fireEvent.keyDown(input, { key: " ", code: "Space" });
      });
    } finally {
      input.remove();
    }

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "待回忆",
      grandchild: null,
    });
  });

  it("keeps readonly left-click flip flow working after host fullscreen toggles", async () => {
    renderInRouter(
      <MindMapReviewFlow
        title="Root"
        palaceId={1}
        sessionKind="practice"
        reviewEditorState={editorState}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "宿主半屏切换" }));
    await waitFor(() => {
      expect(screen.getByText("frame-readonly-immersive")).toBeTruthy();
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "root", text: "Root" }]);
    });
    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "Child",
        grandchild: null,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "宿主半屏切换" }));
    await waitFor(() => {
      expect(screen.getByText("frame-readonly-plain")).toBeTruthy();
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "Child",
        grandchild: "待回忆",
      });
    });
  });

  it("runs dedicated mini-checkpoint mode through the shared flow and requires hover before space pour", async () => {
    const miniEditorState = {
      editor_doc: {
        root: {
          data: { text: "Root", uid: "root" },
          children: [
            {
              data: { text: "Child", uid: "child" },
              children: [
                {
                  data: { text: "Grandchild", uid: "grandchild" },
                  children: [],
                },
              ],
            },
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
        revealMode="mini-checkpoint"
        checkpointNodeUids={["child"]}
        reviewEditorState={miniEditorState}
        onComplete={vi.fn()}
      />,
    );

    expect(getLatestMindMapFrameProps()?.miniPalacePracticeActive).toBe(true);
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "待回忆",
      grandchild: null,
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onMiniPalacePour?.();
    });

    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "待回忆",
      grandchild: null,
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeClick?.([{ uid: "child", text: "Child" }]);
    });
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "Child",
      grandchild: null,
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeHover?.([{ uid: "child", text: "Child" }]);
      getLatestMindMapFrameProps()?.onMiniPalacePour?.();
    });

    expect(getLatestMindMapFrameProps()?.reviewFxSignal).toEqual(
      expect.objectContaining({
        type: "card_reveal",
        relatedNodeUids: ["grandchild"],
      }),
    );
    expect(getVisibleTextsFromLatestFrame()).toEqual({
      root: "Root",
      child: "Child",
      grandchild: "Grandchild",
    });
  });

  it("keeps readonly right-click branch handling wired through the frame", async () => {
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

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "Child",
        grandchild: "待回忆",
      });
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeContextMenu?.([{ uid: "child", text: "Child" }]);
    });

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "Child",
        grandchild: null,
      });
    });

    expect(timer.registerActivity).toHaveBeenCalledWith("practice_interaction", {
      source: "right_click",
    });
  });

  it("lets root right-click hide revealed descendants while keeping the root visible", async () => {
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

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: "Child",
        grandchild: "待回忆",
      });
    });

    await act(async () => {
      getLatestMindMapFrameProps()?.onNodeContextMenu?.([{ uid: "root", text: "Root" }]);
    });

    await waitFor(() => {
      expect(getVisibleTextsFromLatestFrame()).toEqual({
        root: "Root",
        child: null,
        grandchild: null,
      });
    });
  });
});
