import { PalaceQuizPage as FeaturePage } from '@/modules/quiz/public'
import type { PalaceQuizAnswerWindowProps } from '@/modules/quiz/public'
import { FreestyleScopeQuizDialog } from '@/widgets/freestyle-scope-quiz'

// The route wrapper composes the shared answer UI at the module boundary.

const QuizAnswerWindow = ({
  open, onClose, palaceId, questionIds, initialQuestionId, onQuestionNavigate, onQuestionDeleted,
}: PalaceQuizAnswerWindowProps) => (
  <FreestyleScopeQuizDialog
    source="questions"
    open={open}
    onOpenChange={(next) => { if (!next) onClose() }}
    questionSet={{ palaceId, questionIds, initialQuestionId, onQuestionNavigate, onQuestionDeleted }}
  />
)

// Route wrapper around a lazy barrel component; see pages/today/ImmersiveFreestylePage.tsx for why this must not re-export it.
export default function QuizWorkspacePage() {
  return <FeaturePage AnswerWindow={QuizAnswerWindow} />
}
