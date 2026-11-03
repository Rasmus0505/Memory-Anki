/**
 * Session-only fold/scroll memory for the palace directory panel.
 *
 * The editor route is keyed by pathname, so opening another palace mounts a
 * fresh editor page — and a fresh directory panel. Rebuilding the folds from
 * scratch made the panel look like it had reloaded on every chapter switch.
 * Keeping the state here (module memory, not storage) preserves it across those
 * remounts while letting a real page reload start folded again.
 */
const expandedKeysByViewState = new Map<string, ReadonlySet<string>>()
const scrollTopByViewState = new Map<string, number>()

export function readDirectoryExpandedKeys(viewStateKey: string): ReadonlySet<string> | undefined {
  return expandedKeysByViewState.get(viewStateKey)
}

export function writeDirectoryExpandedKeys(viewStateKey: string, keys: ReadonlySet<string>) {
  expandedKeysByViewState.set(viewStateKey, new Set(keys))
}

export function readDirectoryScrollTop(viewStateKey: string): number | undefined {
  return scrollTopByViewState.get(viewStateKey)
}

export function writeDirectoryScrollTop(viewStateKey: string, top: number) {
  scrollTopByViewState.set(viewStateKey, top)
}

/** Test hook: drop the session fold/scroll memory between cases. */
export function resetPalaceDirectoryViewState() {
  expandedKeysByViewState.clear()
  scrollTopByViewState.clear()
}
