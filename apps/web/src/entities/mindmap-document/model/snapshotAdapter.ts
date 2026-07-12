import type { MindMapEditorState } from '@/shared/api/contracts'
import { normalizeMindMapDocument, type MindMapEditorSnapshot } from './document'

interface LegacyEditorResponse extends Partial<MindMapEditorState> {
  snapshot?: Partial<MindMapEditorSnapshot> | null
}

export function readMindMapEditorSnapshot(response: LegacyEditorResponse): MindMapEditorSnapshot {
  const snapshot = response.snapshot
  if (snapshot?.document) {
    return {
      schemaVersion: 1,
      document: normalizeMindMapDocument(snapshot.document),
      editorPreferences: snapshot.editorPreferences ?? {},
      localPreferences: snapshot.localPreferences ?? {},
      language: snapshot.language || 'zh',
      revision: snapshot.revision || '',
    }
  }
  return {
    schemaVersion: 1,
    document: normalizeMindMapDocument(response.editor_doc),
    editorPreferences: response.editor_config ?? {},
    localPreferences: response.editor_local_config ?? {},
    language: response.lang || 'zh',
    revision: response.editor_fingerprint || '',
  }
}

export function snapshotToLegacyEditorState(snapshot: MindMapEditorSnapshot): MindMapEditorState {
  return {
    editor_doc: snapshot.document,
    editor_config: snapshot.editorPreferences,
    editor_local_config: snapshot.localPreferences,
    lang: snapshot.language,
    editor_fingerprint: snapshot.revision,
  }
}

export function readMindMapEditorState(response: LegacyEditorResponse): MindMapEditorState {
  return snapshotToLegacyEditorState(readMindMapEditorSnapshot(response))
}

export function buildMindMapSaveCommand(editorState: MindMapEditorState, source?: string) {
  const snapshot = readMindMapEditorSnapshot(editorState)
  return {
    snapshot,
    baseRevision: snapshot.revision || null,
    ...(source ? { source } : {}),
  }
}
