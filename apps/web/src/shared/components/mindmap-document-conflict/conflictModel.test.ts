import { describe, expect, it } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { mergeIndependentNodeEdits, summarizeConflictSnapshot } from './conflictModel'

function state(a = 'A', b = 'B'): MindMapEditorState {
  return { editor_doc: { root: { data: { uid: 'root', text: 'Title' }, children: [
    { data: { uid: 'a', text: a, custom: { preserve: true } } },
    { data: { uid: 'b', text: b } },
  ] } }, editor_config: {}, editor_local_config: {}, lang: 'zh' }
}
describe('safe independent UID conflict merge', () => {
  it('combines independent rich node edits without mutating inputs or losing extension data', () => {
    const base = state(), local = state('<b>Local</b>'), remote = state('A', 'Remote')
    const before = JSON.stringify([base, local, remote])
    const result = mergeIndependentNodeEdits(base, local, { ...remote, editor_fingerprint: 'remote-revision' })
    expect(result.snapshot).toEqual({ ...state('<b>Local</b>', 'Remote'), editor_fingerprint: 'remote-revision' })
    expect(JSON.stringify([base, local, remote])).toBe(before)
  })
  it('does not invent a baseline or silently choose a competing node edit', () => {
    expect(mergeIndependentNodeEdits(undefined, state('local'), state('remote')).reason).toContain('没有共同基线')
    expect(mergeIndependentNodeEdits(state(), state('local'), state('remote')).reason).toContain('节点 a')
  })
  it('accepts equal concurrent edits and independent configuration changes', () => {
    const local = { ...state('same'), editor_config: { theme: 'dark' } }
    const remote = { ...state('same'), lang: 'en' }
    expect(mergeIndependentNodeEdits(state(), local, remote).snapshot).toEqual({ ...local, lang: 'en' })
    expect(mergeIndependentNodeEdits(state(), local, { ...remote, editor_config: { theme: 'light' } }).reason).toContain('编辑配置')
  })
  it.each(['delete', 'move', 'duplicate', 'missing'] as const)('rejects unsafe %s topology or UID', (mode) => {
    const changed = state()
    const doc = changed.editor_doc as { root: { children: { data: { uid?: string } }[] } }
    if (mode === 'delete') doc.root.children.pop()
    if (mode === 'move') doc.root.children.reverse()
    if (mode === 'duplicate') doc.root.children[1].data.uid = 'a'
    if (mode === 'missing') delete doc.root.children[1].data.uid
    expect(mergeIndependentNodeEdits(state(), changed, state('remote')).snapshot).toBeNull()
  })
  it('handles serialized documents but refuses malformed or absent remote snapshots', () => {
    const serialized = { ...state(), editor_doc: JSON.stringify(state().editor_doc) }
    expect(mergeIndependentNodeEdits(serialized, state('local'), state('A', 'remote')).snapshot).not.toBeNull()
    expect(mergeIndependentNodeEdits(state(), state(), null).snapshot).toBeNull()
    expect(mergeIndependentNodeEdits(state(), { ...state(), editor_doc: '{' }, state()).snapshot).toBeNull()
  })
  it('counts all nodes and renders plain summaries rather than active HTML', () => {
    const summary = summarizeConflictSnapshot(state('<b>Local &amp; safe</b>', '<img src=x onerror=bad>Remote'))
    expect(summary.nodeCount).toBe(3)
    expect(summary.title).toBe('Title')
    expect(summary.lines).toEqual(['Title', 'Local & safe', 'Remote'])
  })
})
