import { ProfileSettingsPage as FeaturePage, MemoryAnkiShortcutsSettings } from '@/modules/settings/public'

export default function SettingsOverviewPage() {
  return <FeaturePage shortcutsSettings={<MemoryAnkiShortcutsSettings />} />
}
