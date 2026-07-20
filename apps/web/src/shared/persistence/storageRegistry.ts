export type StorageArea = 'localStorage' | 'sessionStorage'

export interface RegisteredStorageKey {
  id: string
  key: string
  area: StorageArea
  owner: string
  purpose: string
}

export interface DuplicateStorageKey {
  area: StorageArea
  key: string
  ids: string[]
}

export function findDuplicateStorageKeys(
  entries: ReadonlyArray<RegisteredStorageKey>,
): DuplicateStorageKey[] {
  const grouped = new Map<string, RegisteredStorageKey[]>()
  for (const entry of entries) {
    const groupKey = `${entry.area}:${entry.key}`
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), entry])
  }

  return Array.from(grouped.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      area: group[0].area,
      key: group[0].key,
      ids: group.map((entry) => entry.id),
    }))
}

export function assertNoDuplicateStorageKeys(
  entries: ReadonlyArray<RegisteredStorageKey>,
) {
  const duplicates = findDuplicateStorageKeys(entries)
  if (duplicates.length === 0) return
  const message = duplicates
    .map((duplicate) => {
      const ids = duplicate.ids.join(', ')
      return `${duplicate.area} "${duplicate.key}" used by ${ids}`
    })
    .join('; ')
  throw new Error(`Duplicate storage key registered: ${message}`)
}

export function defineStorageRegistry<const Entries extends ReadonlyArray<RegisteredStorageKey>>(
  entries: Entries,
) {
  assertNoDuplicateStorageKeys(entries)
  return entries
}

export const REGISTERED_STORAGE_KEYS = defineStorageRegistry([
  {
    id: 'theme.preference',
    key: 'memory-anki-theme',
    area: 'localStorage',
    owner: 'shared/theme',
    purpose: 'Theme preference selected before client preferences are loaded.',
  },
  {
    id: 'api.token',
    key: 'memory_anki_api_token',
    area: 'localStorage',
    owner: 'shared/api',
    purpose: 'Local API token for remote access.',
  },
  {
    id: 'timer.automationConfig',
    key: 'memory-anki-timer-automation-config',
    area: 'localStorage',
    owner: 'shared/components/session',
    purpose: 'Legacy timer automation preference before backend preference migration.',
  },
  {
    id: 'timer.focusConfig',
    key: 'memory-anki-timer-focus-config',
    area: 'localStorage',
    owner: 'shared/components/session',
    purpose: 'Legacy timer focus preference before backend preference migration.',
  },
  {
    id: 'breakGuard.config',
    key: 'memory-anki-break-guard-config',
    area: 'localStorage',
    owner: 'shared/components/session',
    purpose: 'Legacy break guard preference before backend preference migration.',
  },
  {
    id: 'breakGuard.logs',
    key: 'memory-anki-break-guard-logs',
    area: 'localStorage',
    owner: 'shared/components/session',
    purpose: 'Local break guard history.',
  },
  {
    id: 'clientPreference.memoryAnkiShortcuts',
    key: 'memory_anki_shortcuts',
    area: 'localStorage',
    owner: 'entities/preferences',
    purpose: 'Legacy keyboard shortcut preference before backend preference migration.',
  },
  {
    id: 'clientPreference.englishPracticeSettings',
    key: 'memory-anki-english-practice-settings-v2',
    area: 'localStorage',
    owner: 'entities/preferences',
    purpose: 'Legacy English practice preference before backend preference migration.',
  },
  {
    id: 'clientPreference.reviewFeedbackSettings',
    key: 'memory-anki-review-feedback-settings-v2',
    area: 'localStorage',
    owner: 'shared/feedback',
    purpose: 'Legacy review feedback preference before backend preference migration.',
  },
  {
    id: 'clientPreference.palaceListViewSettings',
    key: 'palace_list_view_settings',
    area: 'localStorage',
    owner: 'entities/preferences',
    purpose: 'Legacy palace list view preference before backend preference migration.',
  },
  {
    id: 'clientPreference.palaceShelfViewSettings',
    key: 'palace_shelf_view_settings',
    area: 'localStorage',
    owner: 'entities/preferences',
    purpose: 'Legacy palace shelf view preference before backend preference migration.',
  },
  {
    id: 'clientPreference.reviewQueueViewSettings',
    key: 'review_queue_view_settings',
    area: 'localStorage',
    owner: 'features/review',
    purpose: 'Review queue sort mode (due / node count / overdue / title).',
  },
  {
    id: 'clientPreference.dashboardDurationFilter',
    key: 'memory_anki_dashboard_total_duration_filter',
    area: 'localStorage',
    owner: 'features/dashboard',
    purpose: 'Legacy dashboard duration filter before backend preference migration.',
  },
  {
    id: 'pageHistory.device',
    key: 'memory-anki.page-history.device.v1',
    area: 'localStorage',
    owner: 'shared/page-history',
    purpose: 'Versioned seven-day device page history with LRU cleanup.',
  },
  {
    id: 'pageHistory.session',
    key: 'memory-anki.page-history.session.v1',
    area: 'sessionStorage',
    owner: 'shared/page-history',
    purpose: 'Per-tab navigation entry snapshots keyed by router location key.',
  },
  {
    id: 'pageHistory.workspace',
    key: 'memory-anki.page-history.workspace-id',
    area: 'sessionStorage',
    owner: 'shared/page-history',
    purpose: 'Independent page-history workspace identity for each browser tab.',
  },
  {
    id: 'pageHistory.launchRestored',
    key: 'memory-anki.page-history.launch-restored',
    area: 'sessionStorage',
    owner: 'shared/page-history',
    purpose: 'Prevents repeated launch restoration redirects in one tab.',
  },
] as const)
