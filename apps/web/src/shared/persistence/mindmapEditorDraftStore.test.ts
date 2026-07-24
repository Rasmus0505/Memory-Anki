import { afterEach, describe, expect, it } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  buildMindMapEditorDraftKey,
  clearMindMapEditorDraft,
  readMindMapEditorDraft,
  resetMindMapEditorDraftStoreForTest,
  stableMindMapEditorContentFingerprint,
  writeMindMapEditorDraft,
} from './mindmapEditorDraftStore'

function buildState(title: string): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: { text: title, uid: 'root' },
        children: [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
    editor_fingerprint: `fp-${title}`,
  }
}

describe('mindmapEditorDraftStore', () => {
  afterEach(async () => {
    await resetMindMapEditorDraftStoreForTest()
  })

  it('overwrites the same resource key instead of stacking drafts', async () => {
    const key = buildMindMapEditorDraftKey('persisted-mindmap', 7)
    await writeMindMapEditorDraft({
      resourceKey: key,
      snapshot: buildState('one'),
      changeVersion: 1,
      baseEditorFingerprint: 'base',
    })
    await writeMindMapEditorDraft({
      resourceKey: key,
      snapshot: buildState('two'),
      changeVersion: 2,
      baseEditorFingerprint: 'base',
    })

    const draft = await readMindMapEditorDraft(key)
    expect(draft?.changeVersion).toBe(2)
    expect(stableMindMapEditorContentFingerprint(draft?.snapshot)).toBe(
      stableMindMapEditorContentFingerprint(buildState('two')),
    )
  })

  it('clears a draft slot', async () => {
    const key = buildMindMapEditorDraftKey('palace-subject-mindmap', 3)
    await writeMindMapEditorDraft({
      resourceKey: key,
      snapshot: buildState('keep'),
      changeVersion: 1,
    })
    await clearMindMapEditorDraft(key)
    expect(await readMindMapEditorDraft(key)).toBeNull()
  })
})
