import { useCallback, useEffect, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { archiveMindMapEditorConflict, type MindMapEditorConflict } from '@/shared/persistence/mindmapEditorDraftStore'

export type MindMapConflictResolution = {
  ownerId: number
  operationId: number
} & ({ choice: 'local' | 'remote' } | { choice: 'manual'; snapshot: MindMapEditorState })

export function useMindMapDocumentConflict(
  ownerId: number | null,
  draftKeyFor: (ownerId: number) => string,
  apply: (snapshot: MindMapEditorState, remote: MindMapEditorState, dirty: boolean) => void,
) {
  const [pendingConflict, setPendingConflict] = useState<MindMapEditorConflict | null>(null)
  const conflictRef = useRef<MindMapEditorConflict | null>(null)
  const sequence = useRef(0)
  const currentOwner = useRef(ownerId)
  const ownerGeneration = useRef(0)
  if (currentOwner.current !== ownerId) ownerGeneration.current += 1
  currentOwner.current = ownerId
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const resolving = useRef(false)
  const publishConflict = useCallback((conflict: Omit<MindMapEditorConflict, 'operationId'>) => {
    const next = { ...conflict, operationId: ++sequence.current }
    conflictRef.current = next
    setPendingConflict(next)
    return next
  }, [])
  const resolveConflict = useCallback(async (resolution: MindMapConflictResolution): Promise<boolean> => {
    const conflict = conflictRef.current
    if (!mounted.current || !conflict || resolving.current || currentOwner.current !== resolution.ownerId
      || conflict.ownerId !== resolution.ownerId || conflict.operationId !== resolution.operationId
      || !conflict.remoteSnapshot || !conflict.remoteEditorFingerprint) return false
    const generation = ownerGeneration.current
    resolving.current = true
    try {
      await archiveMindMapEditorConflict(draftKeyFor(conflict.ownerId), conflict)
      if (!mounted.current || generation !== ownerGeneration.current
        || currentOwner.current !== conflict.ownerId || conflictRef.current !== conflict) return false
      const snapshot = resolution.choice === 'manual' ? resolution.snapshot
        : resolution.choice === 'local' ? conflict.localSnapshot : conflict.remoteSnapshot
      conflictRef.current = null
      setPendingConflict(null)
      apply(snapshot, conflict.remoteSnapshot, resolution.choice !== 'remote')
      return true
    } finally {
      resolving.current = false
    }
  }, [apply, draftKeyFor])
  return { pendingConflict: pendingConflict?.ownerId === ownerId ? pendingConflict : null,
    conflictRef, publishConflict, resolveConflict }
}
