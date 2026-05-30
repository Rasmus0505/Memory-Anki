import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapFrame } from './MindMapFrame'

function buildEditorState(label = '根节点') {
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

function attachIframeBridge(iframe: HTMLIFrameElement) {
  const syncHostEditorState = vi.fn()
  const applyHostState = vi.fn()
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      syncHostEditorState,
      applyHostState,
    },
  })
  fireEvent.load(iframe)
  return { syncHostEditorState, applyHostState }
}

describe('MindMapFrame sync behavior', () => {
  beforeEach(() => {
    window.__memoryAnkiMindMapHosts = {}
  })

  afterEach(() => {
    window.__memoryAnkiMindMapHosts = {}
    vi.restoreAllMocks()
  })

  it('does not immediately sync back into the host after a local edit save callback updates props', async () => {
    function Harness() {
      const [editorState, setEditorState] = useState(buildEditorState())
      return (
        <MindMapFrame
          editorState={editorState}
          syncOnPropChange
          onEditorStateChange={setEditorState}
        />
      )
    }

    render(<Harness />)
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    const hostBridge = Object.values(window.__memoryAnkiMindMapHosts ?? {})[0]
    await act(async () => {
      hostBridge?.saveMindMapData?.({
        root: {
          data: { text: '本地修改', uid: 'root-1' },
          children: [],
        },
      })
    })

    await waitFor(() => {
      expect(hostBridge?.getMindMapData?.()).toEqual({
        root: {
          data: { text: '本地修改', uid: 'root-1' },
          children: [],
        },
      })
    })
    expect(bridgeMocks.syncHostEditorState).not.toHaveBeenCalled()
  })

  it('uses soft sync for prop updates and replace sync for forceSyncKey updates without remounting the iframe', async () => {
    const initialState = buildEditorState()
    const nextState = buildEditorState('服务端回写')
    const { rerender } = render(
      <MindMapFrame
        editorState={initialState}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )
    const iframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    const bridgeMocks = attachIframeBridge(iframe)

    await waitFor(() => {
      expect(bridgeMocks.applyHostState).toHaveBeenCalled()
    })

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        syncIntent="soft"
        syncReason="review_flip"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'soft',
          syncReason: 'review_flip',
          editorState: nextState,
        }),
      )
    })

    const sameIframe = screen.getByTitle('mind-map-editor') as HTMLIFrameElement
    expect(sameIframe).toBe(iframe)

    rerender(
      <MindMapFrame
        editorState={nextState}
        syncOnPropChange
        syncIntent="soft"
        forceSyncKey="replace-1"
        forceSyncIntent="replace"
        onEditorStateChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(bridgeMocks.syncHostEditorState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncIntent: 'replace',
          syncReason: null,
          editorState: nextState,
        }),
      )
    })
    expect(screen.getByTitle('mind-map-editor')).toBe(iframe)
  })
})
