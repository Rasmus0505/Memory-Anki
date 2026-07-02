import * as React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
} from "@/shared/feedback/reviewFeedbackSettings";

export const persistStudySessionRecordMock = vi.fn();

vi.mock("@/entities/session/model", async () => {
  const actual = await vi.importActual<typeof import("@/entities/session/model")>(
    "@/entities/session/model",
  );
  return {
    ...actual,
    persistStudySessionRecord: (...args: unknown[]) => persistStudySessionRecordMock(...args),
  };
});

export const timer = {
  effectiveSeconds: 7,
  idleSeconds: 0,
  pauseCount: 0,
  status: "running" as const,
  startedAt: Date.now(),
  durationEdited: false,
  glowState: "running" as const,
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  leaveScene: vi.fn(),
  adjustDuration: vi.fn(),
  registerActivity: vi.fn(),
  logEvent: vi.fn(),
  complete: vi.fn(async () => ({ effectiveSeconds: 7 })),
  reset: vi.fn(),
};

export const useTimedSessionMock = vi.fn();
export const openQuizLauncherMock = vi.fn();

vi.mock("@/shared/hooks/useTimedSession", () => ({
  useTimedSession: (args: unknown) => useTimedSessionMock(args),
}));

vi.mock("@/features/palace-quiz/QuizLauncherProvider", () => ({
  useQuizLauncher: () => ({
    openQuizLauncher: (...args: unknown[]) => openQuizLauncherMock(...args),
  }),
}));

export const mindMapFrameMock = vi.fn();

vi.mock("@/shared/components/mindmap-host", () => ({
  MindMapFrame: React.forwardRef((props: Record<string, unknown>, ref) => {
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
      <div data-testid="mind-map-frame">
        <div>{`frame-${props.readonly ? "readonly" : "editable"}-${fullscreen ? "immersive" : "plain"}`}</div>
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
    modeToggle,
    bilinkSearchAction,
    quizAction,
    miniPalaceAction,
    immersiveAction,
    nativeFullscreenAction,
    clearUiAction,
  }: Record<string, any>) => (
    <div data-testid="mind-map-toolbar">
      {modeToggle ? (
        <button type="button" onClick={modeToggle.onClick}>
          {modeToggle.label}
        </button>
      ) : null}
      {bilinkSearchAction ? (
        <button type="button" onClick={bilinkSearchAction.onClick}>
          {bilinkSearchAction.label}
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

export const editorState = {
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

export const editEditorState = {
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

export function getLatestMindMapFrameProps() {
  return mindMapFrameMock.mock.calls.at(-1)?.[0] as Record<string, any> | undefined;
}

export function getVisibleTextsFromLatestFrame() {
  const latestCall = getLatestMindMapFrameProps();
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
  persistStudySessionRecordMock.mockReset();
  persistStudySessionRecordMock.mockResolvedValue(null);
  timer.complete.mockClear();
  timer.registerActivity.mockClear();
  timer.logEvent.mockClear();
  timer.reset.mockClear();
  mindMapFrameMock.mockClear();
  useTimedSessionMock.mockClear();
  openQuizLauncherMock.mockClear();
  useTimedSessionMock.mockImplementation(() => timer);
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
}
