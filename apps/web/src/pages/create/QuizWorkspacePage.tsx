import { PalaceQuizPage as FeaturePage } from '@/modules/quiz/public'

// Route wrapper around a lazy barrel component; see pages/today/ImmersiveFreestylePage.tsx for why this must not re-export it.
export default function QuizWorkspacePage() {
  return <FeaturePage />
}
