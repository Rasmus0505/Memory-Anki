import * as React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
// 预载懒加载的庆祝组件，让它们在断言前已可同步渲染，而不是等首次动态 import 完成。
import "@/shared/components/celebration/ComboMilestoneBurst";
import "@/shared/components/celebration/CompletionCelebration";
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
} from "@/shared/feedback/reviewFeedbackSettings";
import type { MindMapEditorState } from "@/shared/api/contracts";

export const openQuizLauncherMock = vi.fn();

vi.mock("@/widgets/quiz-launcher", () => ({
  useQuizLauncher: () => ({
    openQuizLauncher: (...args: unknown[]) => openQuizLauncherMock(...args),
  }),
}));

export const mindMapFrameMock = vi.fn();

vi.mock("@/modules/content/ui/mindmap-editor", () => ({
  MindMapEditorSurface: React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => ({
      setUiCleared: vi.fn((next: boolean) => {
        (props.onUiClearedChange as ((active: boolean) => void) | undefined)?.(
          next,
        );
      }),
      toggleUiCleared: vi.fn(() => {
        (props.onUiClearedChange as ((active: boolean) => void) | undefined)?.(
          true,
        );
      }),
      focusNode: vi.fn((nodeUid: string | null) => {
        if (!nodeUid) return;
        (props.onNodeActive as ((nodes: unknown[]) => void) | undefined)?.([
          { uid: nodeUid, text: nodeUid, note: "", memoryAnkiId: null },
        ]);
      }),
      fitView: vi.fn(),
      enterFullscreen: vi.fn(async () => {
        (props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(
          true,
        );
      }),
      exitFullscreen: vi.fn(async () => {
        (props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(
          false,
        );
      }),
      enterNativeFullscreen: vi.fn(async () => {
        (props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(
          true,
        );
      }),
      exitNativeFullscreen: vi.fn(async () => {
        (props.onFullscreenChange as ((active: boolean) => void) | undefined)?.(
          false,
        );
      }),
    }));
    mindMapFrameMock(props);
    const fullscreen = Boolean(props.immersiveModeActive);
    const nextEditorState = {
      ...(props.editorState as Record<string, any>),
      editor_doc: {
        root: {
          data: { text: "Root", uid: "root" },
          children: [
            {
              data: { text: "Child edited", uid: "child" },
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
    };
    return (
      <div data-testid="mind-map-frame" className="relative">
        <div>{`frame-${props.readonly ? "readonly" : "editable"}-${fullscreen ? "immersive" : "plain"}`}</div>
        {props.toolbarContent as React.ReactNode}
        {props.frameOverlay as React.ReactNode}
        <button
          type="button"
          onClick={() =>
            (
              props.onFullscreenToggle as
                | ((active?: boolean) => void)
                | undefined
            )?.()
          }
        >
          宿主半屏切换
        </button>
        <button
          type="button"
          onClick={() =>
            (
              props.onFullscreenChange as
                | ((active: boolean) => void)
                | undefined
            )?.(false)
          }
        >
          退出原生全屏
        </button>
        {!props.readonly &&
        (props.onEditorStateChange as ((nextState: unknown) => void) | undefined) ? (
          <button
            type="button"
            onClick={() =>
              (
                props.onEditorStateChange as
                  | ((nextState: unknown) => void)
                  | undefined
              )?.(nextEditorState)
            }
          >
            宿主编辑保存
          </button>
        ) : null}
      </div>
    );
  }),
  MindMapPageToolbar: ({
    ratingAction,
    modeToggle,
    textAction,
    quizAction,
    miniPalaceAction,
    immersiveAction,
    nativeFullscreenAction,
    clearUiAction,
    moreActions = [],
  }: Record<string, any>) => (
    <div data-testid="mind-map-toolbar">
      {ratingAction ? (
        <button type="button" onClick={ratingAction.onClick}>
          {ratingAction.label}
        </button>
      ) : null}
      {modeToggle ? (
        <button type="button" onClick={modeToggle.onClick}>
          {modeToggle.label}
        </button>
      ) : null}
      {textAction ? (
        <button
          type="button"
          aria-pressed={Boolean(textAction.active)}
          onClick={textAction.onClick}
        >
          {textAction.label}
        </button>
      ) : null}
      {quizAction ? (
        <button type="button" onClick={quizAction.onClick}>
          {quizAction.label}
        </button>
      ) : null}
      {miniPalaceAction ? (
        <button type="button" onClick={miniPalaceAction.onClick}>
          {miniPalaceAction.label}
        </button>
      ) : null}
      {(moreActions as Array<{ label: string; onClick: () => void }>).map((action) => (
        <button key={action.label} type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
      {immersiveAction ? (
        <button type="button" onClick={immersiveAction.onClick}>
          {immersiveAction.label}
        </button>
      ) : null}
      {nativeFullscreenAction ? (
        <button type="button" onClick={nativeFullscreenAction.onClick}>
          {nativeFullscreenAction.label}
        </button>
      ) : null}
      {clearUiAction ? (
        <button type="button" onClick={clearUiAction.onClick}>
          {clearUiAction.label}
        </button>
      ) : null}
    </div>
  ),
}));

export const editorState: MindMapEditorState = {
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

export const editEditorState: MindMapEditorState = {
  ...editorState,
  editor_doc: {
    root: {
      data: { text: "Root edit", uid: "root" },
      children: [
        {
          data: { text: "Child edit", uid: "child" },
          children: [
            {
              data: { text: "Grandchild edit", uid: "grandchild" },
              children: [],
            },
          ],
        },
      ],
    },
  },
};

export function getLatestMindMapEditorSurfaceProps() {
  return mindMapFrameMock.mock.calls.at(-1)?.[0] as Record<string, any> | undefined;
}

export function getVisibleTextsFromLatestFrame() {
  const latestCall = getLatestMindMapEditorSurfaceProps();
  const root = latestCall?.editorState?.editor_doc?.root;
  const child = root?.children?.[0];
  const grandchild = child?.children?.[0];
  return {
    root: root?.data?.text ?? null,
    child: child?.data?.text ?? null,
    grandchild: grandchild?.data?.text ?? null,
  };
}

export function renderInRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

export function setupMindMapReviewFlowTest() {
  mindMapFrameMock.mockClear();
  openQuizLauncherMock.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem(
    REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
    JSON.stringify(DEFAULT_REVIEW_FEEDBACK_SETTINGS),
  );
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(16);
    return 1;
  });
  window.cancelAnimationFrame = vi.fn();
}
