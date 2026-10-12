export function dayRecapStorageKey(localDate: string): string {
  return `freestyle.dayRecap.${localDate}`
}

export function localDateKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isDayRecapPending(storage: Pick<Storage, 'getItem'>, now: Date): boolean {
  return storage.getItem(dayRecapStorageKey(localDateKey(now))) == null
}

export function markDayRecapShown(storage: Pick<Storage, 'setItem'>, now: Date): void {
  storage.setItem(dayRecapStorageKey(localDateKey(now)), '1')
}
