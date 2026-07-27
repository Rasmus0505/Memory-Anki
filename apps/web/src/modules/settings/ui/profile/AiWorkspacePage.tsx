import { AiWorkspaceDialogs } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceDialogs'
import { AiWorkspaceModelsTab } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceModelsTab'
import { AiWorkspaceObservabilityTab } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceObservabilityTab'
import { AiWorkspaceProvidersTab } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceProvidersTab'
import { AiWorkspaceQualityTab } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceQualityTab'
import { AiWorkspaceScenesTab } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceScenesTab'
import { AiSceneMergeOverview } from '@/modules/settings/ui/profile/components/ai-workspace/AiSceneMergeOverview'
import { AiWorkspaceSummaryCards } from '@/modules/settings/ui/profile/components/ai-workspace/AiWorkspaceSummaryCards'
import { useAiWorkspaceController } from '@/modules/settings/ui/profile/hooks/useAiWorkspaceController'
import { workspaceTabToAiTab, type AiTab } from '@/modules/settings/ui/profile/model/ai-tabs'
import {
  buildEmptyModelDraft,
  categorySupportsThinking,
  sceneSupportsThinking,
} from '@/modules/settings/ui/profile/model/ai-workspace'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'

export function AiWorkspacePage({ activeTab }: { activeTab?: Exclude<AiTab, 'blocks'> }) {
  const workspace = useAiWorkspaceController()
  const selectedTab = activeTab ?? workspaceTabToAiTab(workspace.workspaceTab)

  if (workspace.loading) return <LoadingState text="正在加载 AI 管理控制台…" />
  if (workspace.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <p className="text-sm text-destructive">{workspace.error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void workspace.loadSettings()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {selectedTab === 'access' ? (
        <AiWorkspaceSummaryCards
          providerCount={workspace.summary?.provider_count ?? workspace.configurableProviders.length}
          activeModelCount={workspace.summary?.active_model_count ?? workspace.models.length}
          sceneCount={workspace.summary?.scene_count ?? workspace.scenes.length}
          recentSuccessCallCount={workspace.summary?.recent_success_call_count ?? 0}
        />
      ) : null}

      {selectedTab === 'access' ? (
        <AiWorkspaceProvidersTab
          providerSearch={workspace.providerSearch}
          filteredProviders={workspace.filteredProviders}
          providerDrafts={workspace.providerDrafts}
          savingKeys={workspace.savingKeys}
          onProviderSearchChange={workspace.setProviderSearch}
          onProviderDraftChange={(providerKey, draft) =>
            workspace.setProviderDrafts((current) => ({ ...current, [providerKey]: draft }))
          }
          onProviderSave={workspace.handleProviderSave}
          onProviderTest={workspace.handleProviderTest}
          onClearAllApiKeys={workspace.handleClearAllApiKeys}
          onJumpToObservability={workspace.jumpToObservability}
        />
      ) : null}

      {selectedTab === 'models' ? (
        <AiWorkspaceModelsTab
          modelSearch={workspace.modelSearch}
          modelProviderFilter={workspace.modelProviderFilter}
          modelTypeFilter={workspace.modelTypeFilter}
          modelOriginFilter={workspace.modelOriginFilter}
          modelCapabilityFilter={workspace.modelCapabilityFilter}
          newModelType={workspace.newModelType}
          modelDraft={workspace.modelDraft}
          filteredModels={workspace.filteredModels}
          savingKeys={workspace.savingKeys}
          onModelSearchChange={workspace.setModelSearch}
          onModelProviderFilterChange={workspace.setModelProviderFilter}
          onModelTypeFilterChange={workspace.setModelTypeFilter}
          onModelOriginFilterChange={workspace.setModelOriginFilter}
          onModelCapabilityFilterChange={workspace.setModelCapabilityFilter}
          onNewModelTypeChange={(nextType) => {
            workspace.setNewModelType(nextType)
            workspace.setModelDraft(buildEmptyModelDraft(nextType))
          }}
          onModelDraftChange={workspace.setModelDraft}
          onCreateModel={workspace.handleCreateModel}
          onTestModel={workspace.handleTestModel}
          onOpenImpact={workspace.handleOpenImpact}
          onJumpToObservability={workspace.jumpToObservability}
        />
      ) : null}

      {selectedTab === 'scenes' ? (
        <div className="space-y-6">
          <AiSceneMergeOverview modelScenes={workspace.scenes} />
          <AiWorkspaceScenesTab
          categories={workspace.categories}
          currentCategory={workspace.currentCategory}
          currentCategoryKey={workspace.currentCategoryKey}
          currentCategoryScenes={workspace.currentCategoryScenes}
          filteredCurrentScenes={workspace.filteredCurrentScenes}
          sceneSearch={workspace.sceneSearch}
          sceneProviderFilter={workspace.sceneProviderFilter}
          sceneCustomOnly={workspace.sceneCustomOnly}
          batchModel={workspace.batchModel}
          batchThinking={workspace.batchThinking}
          modelSelections={workspace.modelSelections}
          thinkingSelections={workspace.thinkingSelections}
          categoryModelSelections={workspace.categoryModelSelections}
          categoryThinkingSelections={workspace.categoryThinkingSelections}
          savingKeys={workspace.savingKeys}
          onCurrentCategoryChange={workspace.setCurrentCategoryKey}
          onCategoryModelSelectionChange={(category, nextModel) => {
            workspace.setCategoryModelSelections((current) => ({ ...current, [category.key]: nextModel }))
            if (!categorySupportsThinking(category, nextModel)) {
              workspace.setCategoryThinkingSelections((current) => ({ ...current, [category.key]: false }))
            }
          }}
          onCategoryThinkingSelectionChange={(categoryKey, enabled) =>
            workspace.setCategoryThinkingSelections((current) => ({ ...current, [categoryKey]: enabled }))
          }
          onSceneSearchChange={workspace.setSceneSearch}
          onSceneProviderFilterChange={workspace.setSceneProviderFilter}
          onSceneCustomOnlyChange={workspace.setSceneCustomOnly}
          onBatchModelChange={(category, nextModel) => {
            workspace.setBatchModel(nextModel)
            if (!categorySupportsThinking(category, nextModel)) workspace.setBatchThinking(false)
          }}
          onBatchThinkingChange={workspace.setBatchThinking}
          onSceneModelSelectionChange={(scene, nextModel) => {
            workspace.setModelSelections((current) => ({ ...current, [scene.key]: nextModel }))
            if (!sceneSupportsThinking(scene, nextModel)) {
              workspace.setThinkingSelections((current) => ({ ...current, [scene.key]: false }))
            }
          }}
          onSceneThinkingSelectionChange={(sceneKey, enabled) =>
            workspace.setThinkingSelections((current) => ({ ...current, [sceneKey]: enabled }))
          }
          onCategorySave={workspace.handleCategorySave}
          onRestoreCategoryScenes={workspace.handleRestoreCategoryScenes}
          onApplyBatch={workspace.handleApplyBatch}
          onSceneSave={workspace.handleSceneSave}
          onRestoreScene={workspace.handleRestoreScene}
            onJumpToObservability={workspace.jumpToObservability}
          />
        </div>
      ) : null}

      {selectedTab === 'observability' ? (
        <div className="space-y-6">
          <AiWorkspaceQualityTab />
          <AiWorkspaceObservabilityTab
            logFilters={workspace.logFilters}
            logs={workspace.logs}
            logsLoading={workspace.logsLoading}
            onLogFilterChange={workspace.setLogFilters}
            onLoadLogs={() => workspace.loadLogs()}
            onOpenLogDetail={workspace.handleOpenLogDetail}
          />
        </div>
      ) : null}

      <AiWorkspaceDialogs
        impactOpen={workspace.impactOpen}
        impactLoading={workspace.impactLoading}
        impactModel={workspace.impactModel}
        impact={workspace.impact}
        connectionOpen={workspace.connectionOpen}
        connectionLoading={workspace.connectionLoading}
        connectionTitle={workspace.connectionTitle}
        connectionResult={workspace.connectionResult}
        logDetailOpen={workspace.logDetailOpen}
        logDetailLoading={workspace.logDetailLoading}
        logDetail={workspace.logDetail}
        savingKeys={workspace.savingKeys}
        onImpactOpenChange={workspace.setImpactOpen}
        onConnectionOpenChange={workspace.setConnectionOpen}
        onLogDetailOpenChange={workspace.setLogDetailOpen}
        onDeleteModel={workspace.handleDeleteModel}
      />
    </div>
  )
}