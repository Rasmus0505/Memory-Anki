/**
 * The card a recall cue is for: the hidden child a learner would flip next.
 *
 * Mirrors the flip order of a reveal click — only revealed nodes open their
 * children, and the shallowest hidden child wins (level order). Pure so the
 * hook stays a thin timer/state wrapper.
 */

export interface RecallCueNode {
  id: string
  text: string
  children: RecallCueNode[]
}

export function findRecallCueTarget(
  root: RecallCueNode | null,
  revealMap: Record<string, string> | null | undefined,
  allowedNodeIds: ReadonlySet<string> | null,
): RecallCueNode | null {
  if (!root) return null
  const stateOf = (id: string) => revealMap?.[id] ?? 'hidden'
  const queue: RecallCueNode[] = [root]
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]
    if (node !== root && stateOf(node.id) !== 'revealed') continue
    for (const child of node.children) {
      if (stateOf(child.id) === 'hidden' && (!allowedNodeIds || allowedNodeIds.has(child.id))) {
        return child
      }
      queue.push(child)
    }
  }
  return null
}
