import ProfileSettingsPage from '@/modules/settings/ui/profile/ProfileSettingsPage'
import { MemoryAnkiShortcutsSettings } from '@/modules/settings/ui/shortcuts/MemoryAnkiShortcutsSettings'

export default function SettingsOverviewPage() {
  return <ProfileSettingsPage shortcutsSettings={<MemoryAnkiShortcutsSettings />} />
}
