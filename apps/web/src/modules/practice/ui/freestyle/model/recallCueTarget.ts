/**
 * The cards a recall cue can be about: hidden children of revealed nodes, in
 * level order. These are the nodes a flip would open next.
 *
 * The hook picks which one to show from these candidates, by how close each is
 * to where the learner is looking. Pure so the hook stays a thin timer/state wrapper.
 */

export interface RecallCueNode {
  id: string
  text: string
  children: RecallCueNode[]
}

export function listRecallCueCandidates(
  root: RecallCueNode | null,
  revealMap: Record<string, string> | null | undefined,
  allowedNodeIds: ReadonlySet<string> | null,
): RecallCueNode[] {
  if (!root) return []
  const stateOf = (id: string) => revealMap?.[id] ?? 'hidden'
  const found: RecallCueNode[] = []
  const queue: RecallCueNode[] = [root]
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]
    if (node !== root && stateOf(node.id) !== 'revealed') continue
    for (const child of node.children) {
      if (stateOf(child.id) === 'hidden' && (!allowedNodeIds || allowedNodeIds.has(child.id))) {
        found.push(child)
      }
      queue.push(child)
    }
  }
  return found
}

export function findRecallCueTarget(
  root: RecallCueNode | null,
  revealMap: Record<string, string> | null | undefined,
  allowedNodeIds: ReadonlySet<string> | null,
): RecallCueNode | null {
  return listRecallCueCandidates(root, revealMap, allowedNodeIds)[0] ?? null
}
