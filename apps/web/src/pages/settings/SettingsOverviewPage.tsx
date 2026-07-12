import ProfileSettingsPage from '@/features/profile/ProfileSettingsPage'
import { repairReviewStageProgressApi } from '@/features/review/api'
import { MemoryAnkiShortcutsSettings } from '@/features/shortcuts/MemoryAnkiShortcutsSettings'

export default function SettingsOverviewPage() {
  return (
    <ProfileSettingsPage
      repairReviewStageProgress={repairReviewStageProgressApi}
      shortcutsSettings={<MemoryAnkiShortcutsSettings />}
    />
  )
}
