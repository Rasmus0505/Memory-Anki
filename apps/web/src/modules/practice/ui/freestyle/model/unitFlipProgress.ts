import type { RevealState } from '@/modules/memory/public'

/**
 * Nodes the learner must reveal for this unit: its membership, plus the anchor.
 * Isolation and residual units both include an anchor that is not a member.
 */
export function unitFlipTargetUids(
  nodeUids: Iterable<string> | null | undefined,
  anchorUid?: string | null,
): string[] {
  const ids = new Set<string>()
  for (const raw of nodeUids ?? []) {
    const uid = String(raw || '').trim()
    if (uid) ids.add(uid)
  }
  const anchor = String(anchorUid || '').trim()
  if (anchor) ids.add(anchor)
  return [...ids]
}

/**
 * Flip targets for the current freestyle unit review — membership only,
 * never the whole palace document.
 */
export function countUnitFlipProgress(
  revealMap: Record<string, RevealState | undefined>,
  unitNodeUids: Iterable<string> | null | undefined,
  anchorUid?: string | null,
): { revealed: number; total: number } {
  const ids = new Set<string>()
  for (const raw of unitNodeUids ?? []) {
    const uid = String(raw || '').trim()
    if (uid) ids.add(uid)
  }
  const anchor = String(anchorUid || '').trim()
  if (anchor) ids.add(anchor)

  const total = ids.size
  let revealed = 0
  for (const uid of ids) {
    if ((revealMap[uid] ?? 'hidden') === 'revealed') revealed += 1
  }
  return {
    revealed: Math.max(0, Math.min(total, revealed)),
    total,
  }
}
