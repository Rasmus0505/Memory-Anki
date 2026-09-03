let suppressed = false
const listeners = new Set<() => void>()

export function isLiveForegroundClockSuppressed() {
  return suppressed
}

export function setLiveForegroundClockSuppressed(next: boolean) {
  if (suppressed === next) return
  suppressed = next
  listeners.forEach((listener) => listener())
}

export function subscribeLiveForegroundClock(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetLiveForegroundClockForTests() {
  suppressed = false
  listeners.clear()
}
