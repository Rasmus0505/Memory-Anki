import { describe, expect, it } from 'vitest'
import { buildMindMapImportValidationFingerprint } from './mindmap-editor'

describe('buildMindMapImportValidationFingerprint', () => {
  it('ignores empty notes added while saving an imported tree', () => {
    const imported = {
      root: {
        data: { text: '德国近代教育', uid: 'imported-root' },
        children: [{ data: { text: '第斯多惠', uid: 'imported-child' }, children: [] }],
      },
    }
    const saved = {
      root: {
        data: { text: '第三节德国近代教育', uid: 'saved-root', note: '' },
        children: [{ data: { text: '第斯多惠', uid: 'saved-child', note: '' }, children: [] }],
      },
    }

    expect(buildMindMapImportValidationFingerprint(imported, '第三节德国近代教育')).toBe(
      buildMindMapImportValidationFingerprint(saved, '第三节德国近代教育'),
    )
  })
})
