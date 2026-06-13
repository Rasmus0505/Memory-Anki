import { fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

export function buildEditorState(label = '根节点') {
  return {
    editor_doc: {
      root: {
        data: { text: label, uid: 'root-1' },
        children: [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh' as const,
  }
}

export function attachIframeBridge(iframe: HTMLIFrameElement) {
  const syncHostEditorState = vi.fn()
  const applyHostState = vi.fn()
  const resetReadonlyInteractionState = vi.fn()
  const emitReviewFx = vi.fn()
  const emitFeedbackFx = vi.fn()
  const clearReviewFx = vi.fn()
  const setUiCleared = vi.fn()
  const toggleUiCleared = vi.fn()
  const enterNativeFullscreen = vi.fn(async () => {})
  const exitNativeFullscreen = vi.fn(async () => {})
  const dispatchEvent = vi.fn(() => true)
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      syncHostEditorState,
      applyHostState,
      resetReadonlyInteractionState,
      emitReviewFx,
      emitFeedbackFx,
      clearReviewFx,
      setUiCleared,
      toggleUiCleared,
      enterNativeFullscreen,
      exitNativeFullscreen,
      dispatchEvent,
    },
  })
  fireEvent.load(iframe)
  return {
    syncHostEditorState,
    applyHostState,
    resetReadonlyInteractionState,
    emitReviewFx,
    emitFeedbackFx,
    clearReviewFx,
    setUiCleared,
    toggleUiCleared,
    enterNativeFullscreen,
    exitNativeFullscreen,
    dispatchEvent,
  }
}

export function getHostBridge(index = 0) {
  return Object.values(window.__memoryAnkiMindMapHosts ?? {})[index]
}
