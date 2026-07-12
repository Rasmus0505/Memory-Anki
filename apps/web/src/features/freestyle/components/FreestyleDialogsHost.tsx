import type { ReactNode } from 'react'
import { FreestyleAiExplainSheet } from '@/features/freestyle/components/FreestyleAiExplainSheet'
import { FreestyleHistoryDialog } from '@/features/freestyle/components/FreestyleHistoryDialog'
import { FreestyleSettingsDialog } from '@/features/freestyle/components/FreestyleSettingsDialog'
import { TodayTrainingSettingsDialog } from '@/features/freestyle/components/TodayTrainingSettingsDialog'
import { WrongQuestionsDialog } from '@/features/freestyle/components/WrongQuestionsDialog'
import type { FreestyleConfig } from '@/features/freestyle/model/freestyle'
import { isQuizCard } from '@/features/freestyle/model/freestyle-cards'
import type { FreestyleMode, TodayTrainingConfig } from '@/features/freestyle/model/today-training'
import { PalaceMemoryLookupDialog } from '@/widgets/palace-memory-lookup'
import type { FreestyleCard, FreestylePalaceContext } from '@/shared/api/contracts'

export function FreestyleDialogsHost({
  aiRunConfigDialog,
  settingsOpen,
  todaySettingsOpen,
  memoryLookupOpen,
  explainSheetOpen,
  historyOpen,
  wrongQuestionsOpen,
  config,
  todayConfig,
  palaceOptions,
  currentCard,
  currentPalaceId,
  mode,
  onSettingsOpenChange,
  onTodaySettingsOpenChange,
  onMemoryLookupOpenChange,
  onExplainSheetOpenChange,
  onHistoryOpenChange,
  onWrongQuestionsOpenChange,
  onStartWrongRetrain,
  onConfigChange,
  onTodayConfigChange,
}: {
  aiRunConfigDialog: ReactNode
  settingsOpen: boolean
  todaySettingsOpen: boolean
  memoryLookupOpen: boolean
  explainSheetOpen: boolean
  historyOpen: boolean
  wrongQuestionsOpen: boolean
  config: FreestyleConfig
  todayConfig: TodayTrainingConfig
  palaceOptions: FreestylePalaceContext[]
  currentCard: FreestyleCard | null
  currentPalaceId: number | null
  mode: FreestyleMode
  onSettingsOpenChange: (open: boolean) => void
  onTodaySettingsOpenChange: (open: boolean) => void
  onMemoryLookupOpenChange: (open: boolean) => void
  onExplainSheetOpenChange: (open: boolean) => void
  onHistoryOpenChange: (open: boolean) => void
  onWrongQuestionsOpenChange: (open: boolean) => void
  onStartWrongRetrain: () => void
  onConfigChange: (updater: (current: FreestyleConfig) => FreestyleConfig) => void
  onTodayConfigChange: (updater: (current: TodayTrainingConfig) => TodayTrainingConfig) => void
}) {
  return (
    <>
      {aiRunConfigDialog}
      <FreestyleSettingsDialog
        open={settingsOpen}
        config={config}
        palaceOptions={palaceOptions}
        onOpenChange={onSettingsOpenChange}
        onConfigChange={onConfigChange}
      />
      <TodayTrainingSettingsDialog
        open={todaySettingsOpen}
        config={todayConfig}
        onOpenChange={onTodaySettingsOpenChange}
        onConfigChange={onTodayConfigChange}
      />
      {currentPalaceId ? (
        <PalaceMemoryLookupDialog
          open={memoryLookupOpen}
          onOpenChange={onMemoryLookupOpenChange}
          currentPalaceId={currentPalaceId}
          followCurrentPalace
        />
      ) : null}
      <FreestyleAiExplainSheet
        open={explainSheetOpen}
        card={isQuizCard(currentCard) ? currentCard : null}
        onClose={() => onExplainSheetOpenChange(false)}
      />
      <FreestyleHistoryDialog
        open={historyOpen}
        currentCard={currentCard}
        currentPalaceId={currentPalaceId}
        mode={mode}
        onOpenChange={onHistoryOpenChange}
      />
      <WrongQuestionsDialog
        open={wrongQuestionsOpen}
        onOpenChange={onWrongQuestionsOpenChange}
        onStartRetrain={onStartWrongRetrain}
      />
    </>
  )
}
