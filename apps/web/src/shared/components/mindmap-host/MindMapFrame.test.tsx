import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MindMapFrame, type MindMapFrameHandle } from './MindMapFrame'

const editorState = {
  editor_doc: {
    root: {
      data: { text: '宫殿', uid: 'root' },
      children: [{ data: { text: '知识点', uid: 'child' }, children: [] }],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

describe('MindMapFrame native host', () => {
  it('renders a native host instead of an iframe', () => {
    render(<MindMapFrame editorState={editorState} onEditorStateChange={vi.fn()} />)

    expect(screen.getByTestId('mindmap-frame-native')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('keeps the fullscreen handle contract', async () => {
    const ref = createRef<MindMapFrameHandle>()
    render(<MindMapFrame ref={ref} editorState={editorState} onEditorStateChange={vi.fn()} />)

    await ref.current?.enterNativeFullscreen()
    expect(screen.getByTestId('mindmap-frame-native').className).toContain(
      'memory-anki-mindmap-native-fullscreen',
    )

    await ref.current?.exitNativeFullscreen()
    expect(screen.getByTestId('mindmap-frame-native').className).not.toContain(
      'memory-anki-mindmap-native-fullscreen',
    )
  })
})
