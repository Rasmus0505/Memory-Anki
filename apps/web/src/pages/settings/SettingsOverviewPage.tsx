import ProfileSettingsPage from '@/features/profile/ProfileSettingsPage'
import { MemoryAnkiShortcutsSettings } from '@/features/shortcuts/MemoryAnkiShortcutsSettings'

export default function SettingsOverviewPage() {
  return <ProfileSettingsPage shortcutsSettings={<MemoryAnkiShortcutsSettings />} />
}
