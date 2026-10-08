/**
 * Local identifier generation.
 *
 * `crypto.randomUUID` is available in every runtime this app targets (modern
 * browsers and Electron), and it is required in secure contexts — which includes
 * `http://127.0.0.1` and `localhost`, where the desktop shell and PWA both run.
 * The fallback exists only for the remaining case of a non-secure origin, which
 * would otherwise throw. It is deliberately not a security boundary: these ids
 * are local correlation handles (queue entries, log rows, recorder sessions),
 * never authorization tokens.
 *
 * This function was previously copy-pasted verbatim in three modules
 * (`mutationQueue`, `appLogs`, `sessionRecorderStore`); keeping one copy means a
 * change to the fallback cannot silently diverge between them.
 */
export function generateLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
