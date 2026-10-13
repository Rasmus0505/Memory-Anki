import { EnglishWorkspacePage as FeaturePage } from '@/modules/english/public'

// Route wrapper around a lazy barrel component; see pages/today/ImmersiveFreestylePage.tsx for why this must not re-export it.
export default function EnglishLibraryPage() {
  return <FeaturePage />
}
