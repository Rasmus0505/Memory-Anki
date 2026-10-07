import { useMemo } from 'react'
import type { EditorDocGraphOptions } from './documentGraphProjection'
import { mergeMindMapGraphOptions, type MindMapCapability } from './capabilities'

/**
 * Memoised signature for the graph decoration options.
 *
 * `mergeMindMapGraphOptions` returns a fresh object every time `capabilities`
 * changes, and the caller uses this string as the `editorDocToGraph` memo key.
 * A bare `JSON.stringify(graphOptions)` therefore re-serialised the whole option
 * payload on every render that touched decorations — including typing, where the
 * decoration inputs have not moved at all.
 *
 * Keying on the decoration inputs instead means the serialise only runs when one
 * of them actually changes.
 */
export function useMindMapGraphOptionsSignature(inputs: {
  capabilities: readonly MindMapCapability[]
  /**
   * Everything `capabilities` is derived from, in a fixed order. The serialise
   * is skipped while these identities are stable.
   */
  segments: unknown
  activeSegmentId: unknown
  segmentColorMode: unknown
  segmentRangeDraft: unknown
  highlightedNodeUids: unknown
  outlinedNodeUids: unknown
  mutedNodeUids: unknown
  masteryByNodeUid: unknown
  statusChipsByNodeUid: unknown
  countBadgeByNodeUid: unknown
  practiceModeActive: unknown
  providedCapabilities: unknown
}): { graphOptions: EditorDocGraphOptions; graphOptionsSignature: string } {
  const {
    capabilities,
    segments, activeSegmentId, segmentColorMode, segmentRangeDraft,
    highlightedNodeUids, outlinedNodeUids, mutedNodeUids,
    masteryByNodeUid, statusChipsByNodeUid, countBadgeByNodeUid,
    practiceModeActive, providedCapabilities,
  } = inputs
  const graphOptions = useMemo(
    () => mergeMindMapGraphOptions(capabilities),
    [capabilities],
  )
  const graphOptionsSignature = useMemo(
    () => JSON.stringify(graphOptions),
    // graphOptions is derived from exactly these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      segments, activeSegmentId, segmentColorMode, segmentRangeDraft,
      highlightedNodeUids, outlinedNodeUids, mutedNodeUids,
      masteryByNodeUid, statusChipsByNodeUid, countBadgeByNodeUid,
      practiceModeActive, providedCapabilities,
    ],
  )
  return { graphOptions, graphOptionsSignature }
}
