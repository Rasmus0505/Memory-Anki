import type { DwellFragmentOverride } from './dwellPolicy'

interface DwellFragmentOverrideEntry extends DwellFragmentOverride {
  id: number
  priority: number
}

const stack: DwellFragmentOverrideEntry[] = []
const listeners = new Set<() => void>()
let nextId = 1
let snapshotVersion = 0
let publishedVersion = -1
let snapshot: DwellFragmentOverride | null = null

function emit() {
  snapshotVersion += 1
  for (const listener of listeners) listener()
}

function winner(): DwellFragmentOverrideEntry | null {
  let best: DwellFragmentOverrideEntry | null = null
  for (const entry of stack) {
    if (
      !best
      || entry.priority > best.priority
      || (entry.priority === best.priority && entry.id > best.id)
    ) {
      best = entry
    }
  }
  return best
}

export function pushDwellFragmentOverride(override: DwellFragmentOverride) {
  const id = nextId
  nextId += 1
  stack.push({
    ...override,
    id,
    priority: override.priority ?? 0,
  })
  emit()
  return id
}

export function updateDwellFragmentOverride(id: number, override: DwellFragmentOverride) {
  const entry = stack.find((item) => item.id === id)
  if (!entry) return
  const priority = override.priority ?? 0
  if (
    entry.scene === override.scene
    && entry.kind === override.kind
    && entry.title === override.title
    && entry.palaceId === override.palaceId
    && entry.sourceKind === override.sourceKind
    && entry.priority === priority
  ) return
  entry.scene = override.scene
  entry.kind = override.kind
  entry.title = override.title
  entry.palaceId = override.palaceId
  entry.sourceKind = override.sourceKind
  entry.priority = priority
  emit()
}

export function popDwellFragmentOverride(id: number) {
  const index = stack.findIndex((item) => item.id === id)
  if (index < 0) return
  stack.splice(index, 1)
  emit()
}

export function peekDwellFragmentOverride(): DwellFragmentOverride | null {
  if (publishedVersion === snapshotVersion) return snapshot
  publishedVersion = snapshotVersion
  const top = winner()
  snapshot = top
    ? {
        scene: top.scene,
        kind: top.kind,
        title: top.title,
        palaceId: top.palaceId,
        sourceKind: top.sourceKind,
        priority: top.priority,
      }
    : null
  return snapshot
}

export function subscribeDwellFragmentOverrides(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetDwellFragmentOverridesForTests() {
  stack.length = 0
  nextId = 1
  snapshot = null
  publishedVersion = -1
  snapshotVersion += 1
  for (const listener of listeners) listener()
}
