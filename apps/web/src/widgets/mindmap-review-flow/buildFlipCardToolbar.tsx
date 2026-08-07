import type { ReactNode, RefObject } from 'react'
import {
  MindMapPageToolbar,
  type MindMapEditorSurfaceHandle,
  type MindMapPageToolbarProps,
} from '@/modules/content/public'

type ToolbarExtensions = Pick<
  MindMapPageToolbarProps,
  | 'embedded'
  | 'taskControl'
  | 'searchControl'
  | 'focusAction'
  | 'fitAction'
  | 'moreActions'
  | 'segmentControl'
  | 'importMindMapAction'
  | 'importTextAction'
  | 'englishAction'
  | 'textAction'
>

export function buildFlipCardToolbar(options: {
  toolbarExtensions?: ToolbarExtensions
  isEditMode: boolean
  englishModeActive: boolean
  textModeActive: boolean
  fullscreen: boolean
  uiCleared: boolean
  nativeFullscreenActive: boolean
  hostFullscreenControl?: boolean
  hidePresentationOverflowActions: boolean
  resolvedPresentationStrategy: 'native-preferred' | 'viewport-only' | string
  modeToggleLabels?: { enterEdit?: string; leaveEdit?: string }
  frameRef: RefObject<MindMapEditorSurfaceHandle | null>
  onToggleMode?: () => void
  onToggleEnglishMode: () => void
  onToggleTextMode: () => void
  onToggleFullscreen: (active?: boolean) => void
}): ReactNode {
  const {
    toolbarExtensions,
    isEditMode,
    englishModeActive,
    textModeActive,
    fullscreen,
    uiCleared,
    nativeFullscreenActive,
    hostFullscreenControl = false,
    hidePresentationOverflowActions,
    resolvedPresentationStrategy,
    modeToggleLabels,
    frameRef,
    onToggleMode,
    onToggleEnglishMode,
    onToggleTextMode,
    onToggleFullscreen,
  } = options

  return (
    <MindMapPageToolbar
      {...toolbarExtensions}
      embedded
      moreActions={toolbarExtensions?.moreActions ?? []}
      modeToggle={
        onToggleMode
          ? {
              label: isEditMode
                ? (modeToggleLabels?.leaveEdit ?? '复习')
                : (modeToggleLabels?.enterEdit ?? '编辑'),
              onClick: onToggleMode,
            }
          : null
      }
      englishAction={{
        label: '英语',
        active: englishModeActive,
        onClick: onToggleEnglishMode,
      }}
      textAction={{
        label: '文字模式',
        active: !isEditMode && textModeActive,
        disabled: isEditMode,
        onClick: onToggleTextMode,
      }}
      immersiveAction={
        hidePresentationOverflowActions || resolvedPresentationStrategy === 'viewport-only'
          ? null
          : {
              label: fullscreen ? '退出网页内全屏' : '网页内全屏',
              active: fullscreen,
              onClick: () => {
                void onToggleFullscreen()
              },
            }
      }
      nativeFullscreenAction={
        hidePresentationOverflowActions
          ? null
          : {
              // A freestyle host owns both presentation buttons; the canvas
              // native state must not decide the host button label.
              label:
                resolvedPresentationStrategy === 'viewport-only'
                  ? (hostFullscreenControl ? fullscreen : nativeFullscreenActive)
                    ? '退出全屏'
                    : '全屏'
                  : (hostFullscreenControl ? fullscreen : nativeFullscreenActive)
                    ? '退出系统全屏'
                    : '系统全屏',
              active: hostFullscreenControl ? fullscreen : nativeFullscreenActive,
              onClick: () => {
                if (hostFullscreenControl) {
                  onToggleFullscreen()
                  return
                }
                void (nativeFullscreenActive
                  ? frameRef.current?.exitFullscreen()
                  : frameRef.current?.enterFullscreen())
              },
            }
      }
      clearUiAction={
        hidePresentationOverflowActions
          ? null
          : {
              label: '清屏',
              active: uiCleared,
              onClick: () => frameRef.current?.toggleUiCleared(),
            }
      }
    />
  )
}
