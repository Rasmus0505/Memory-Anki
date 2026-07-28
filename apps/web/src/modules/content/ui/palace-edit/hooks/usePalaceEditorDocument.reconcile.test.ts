import { describe, expect, it } from 'vitest'
import {
  applyPalaceSaveOverride,
  type PalaceEditorSaveOverride,
} from './usePalaceEditorDocument'
import type { MindMapEditorState } from '@/shared/api/contracts'

const baseState: MindMapEditorState & { expected_editor_fingerprint?: string | null } = {
  editor_doc: { root: { data: { text: '宫殿' } } },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
  editor_fingerprint: 'fp-1',
  expected_editor_fingerprint: 'fp-0',
}

describe('applyPalaceSaveOverride', () => {
  it('leaves normal autosave payloads without reconcile flags', () => {
    expect(applyPalaceSaveOverride(baseState, null)).toEqual(baseState)
  })

  it('injects editor_leave + reconcile_units for leave flushes', () => {
    const override: PalaceEditorSaveOverride = {
      sync_reason: 'editor_leave',
      reconcile_units: true,
    }
    expect(applyPalaceSaveOverride(baseState, override)).toEqual({
      ...baseState,
      sync_reason: 'editor_leave',
      reconcile_units: true,
    })
  })

  it('injects mark_change without forcing reconcile_units (backend mark-delta covers it)', () => {
    const override: PalaceEditorSaveOverride = {
      sync_reason: 'mark_change',
    }
    const payload = applyPalaceSaveOverride(baseState, override)
    expect(payload.sync_reason).toBe('mark_change')
    expect(payload.reconcile_units).toBeUndefined()
  })
})
