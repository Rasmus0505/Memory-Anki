export type PalacePracticeEditorMode = 'edit' | 'recall' | 'preview'

export interface PalacePracticeLiveView {
  palaceId: number | null
  editorMode: PalacePracticeEditorMode
  currentNodeUid: string | null
  revealMap: Record<string, string> | null
  redNodeIds: string[]
}

const MODES: PalacePracticeEditorMode[] = ['edit', 'recall', 'preview']

export function decodePalacePracticeLiveView(raw: unknown): PalacePracticeLiveView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const revealRaw = record.revealMap && typeof record.revealMap === 'object' && !Array.isArray(record.revealMap)
    ? record.revealMap as Record<string, unknown>
    : null
  return {
    palaceId: typeof record.palaceId === 'number' ? record.palaceId : null,
    editorMode: MODES.includes(record.editorMode as PalacePracticeEditorMode)
      ? record.editorMode as PalacePracticeEditorMode
      : 'edit',
    currentNodeUid: typeof record.currentNodeUid === 'string' ? record.currentNodeUid : null,
    revealMap: revealRaw
      ? Object.fromEntries(
          Object.entries(revealRaw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : null,
    redNodeIds: Array.isArray(record.redNodeIds)
      ? record.redNodeIds.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

export function applyPalacePracticeLiveView(
  current: PalacePracticeLiveView,
  remote: PalacePracticeLiveView,
): PalacePracticeLiveView {
  return {
    palaceId: remote.palaceId ?? current.palaceId,
    editorMode: remote.editorMode,
    currentNodeUid: remote.currentNodeUid,
    revealMap: remote.revealMap,
    redNodeIds: remote.redNodeIds,
  }
}

export function palacePracticeSameInteraction(previous: PalacePracticeLiveView, next: PalacePracticeLiveView) {
  return previous.editorMode === next.editorMode
    && previous.currentNodeUid === next.currentNodeUid
    && JSON.stringify(previous.revealMap) === JSON.stringify(next.revealMap)
    && JSON.stringify(previous.redNodeIds) === JSON.stringify(next.redNodeIds)
}
