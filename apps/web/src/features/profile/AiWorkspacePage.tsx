import { LoadingState } from "@/shared/components/state-placeholders";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { AiWorkspaceDialogs } from "@/features/profile/components/ai-workspace/AiWorkspaceDialogs";
import { AiWorkspaceModelsTab } from "@/features/profile/components/ai-workspace/AiWorkspaceModelsTab";
import { AiWorkspaceObservabilityTab } from "@/features/profile/components/ai-workspace/AiWorkspaceObservabilityTab";
import { AiWorkspaceProvidersTab } from "@/features/profile/components/ai-workspace/AiWorkspaceProvidersTab";
import { AiWorkspaceScenesTab } from "@/features/profile/components/ai-workspace/AiWorkspaceScenesTab";
import { AiWorkspaceSummaryCards } from "@/features/profile/components/ai-workspace/AiWorkspaceSummaryCards";
import { useAiWorkspaceController } from "@/features/profile/hooks/useAiWorkspaceController";
import {
  buildEmptyModelDraft,
  categorySupportsThinking,
  normalizeWorkspaceTab,
  sceneSupportsThinking,
  WORKSPACE_TABS,
} from "@/features/profile/model/ai-workspace";

export function AiWorkspacePage() {
  const workspace = useAiWorkspaceController();

  if (workspace.loading) {
    return <LoadingState text="正在加载 AI 管理控制台…" />;
  }

  if (workspace.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <p className="text-sm text-destructive">{workspace.error}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void workspace.loadSettings();
          }}
        >
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AiWorkspaceSummaryCards
        providerCount={
          workspace.summary?.provider_count ?? workspace.configurableProviders.length
        }
        activeModelCount={workspace.summary?.active_model_count ?? workspace.models.length}
        sceneCount={workspace.summary?.scene_count ?? workspace.scenes.length}
        recentSuccessCallCount={workspace.summary?.recent_success_call_count ?? 0}
      />

      <Tabs
        value={workspace.workspaceTab}
        onValueChange={(value) =>
          workspace.setWorkspaceTab(normalizeWorkspaceTab(value))
        }
        className="space-y-4"
      >
        <TabsList className="h-auto flex-wrap rounded-2xl border border-border/70 bg-background/90 p-1">
          {WORKSPACE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="gap-2 rounded-xl px-4 py-2"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="providers" className="space-y-4">
          <AiWorkspaceProvidersTab
            providerSearch={workspace.providerSearch}
            filteredProviders={workspace.filteredProviders}
            providerDrafts={workspace.providerDrafts}
            savingKeys={workspace.savingKeys}
            onProviderSearchChange={workspace.setProviderSearch}
            onProviderDraftChange={(providerKey, draft) =>
              workspace.setProviderDrafts((current) => ({
                ...current,
                [providerKey]: draft,
              }))
            }
            onProviderSave={workspace.handleProviderSave}
            onProviderTest={workspace.handleProviderTest}
            onJumpToObservability={workspace.jumpToObservability}
          />
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
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
              workspace.setNewModelType(nextType);
              workspace.setModelDraft(buildEmptyModelDraft(nextType));
            }}
            onModelDraftChange={workspace.setModelDraft}
            onCreateModel={workspace.handleCreateModel}
            onTestModel={workspace.handleTestModel}
            onOpenImpact={workspace.handleOpenImpact}
            onJumpToObservability={workspace.jumpToObservability}
          />
        </TabsContent>

        <TabsContent value="scenes" className="space-y-4">
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
            testingVoice={workspace.testingVoice}
            onCurrentCategoryChange={workspace.setCurrentCategoryKey}
            onCategoryModelSelectionChange={(category, nextModel) => {
              workspace.setCategoryModelSelections((current) => ({
                ...current,
                [category.key]: nextModel,
              }));
              if (!categorySupportsThinking(category, nextModel)) {
                workspace.setCategoryThinkingSelections((current) => ({
                  ...current,
                  [category.key]: false,
                }));
              }
            }}
            onCategoryThinkingSelectionChange={(categoryKey, enabled) =>
              workspace.setCategoryThinkingSelections((current) => ({
                ...current,
                [categoryKey]: enabled,
              }))
            }
            onSceneSearchChange={workspace.setSceneSearch}
            onSceneProviderFilterChange={workspace.setSceneProviderFilter}
            onSceneCustomOnlyChange={workspace.setSceneCustomOnly}
            onBatchModelChange={(category, nextModel) => {
              workspace.setBatchModel(nextModel);
              if (!categorySupportsThinking(category, nextModel)) {
                workspace.setBatchThinking(false);
              }
            }}
            onBatchThinkingChange={workspace.setBatchThinking}
            onSceneModelSelectionChange={(scene, nextModel) => {
              workspace.setModelSelections((current) => ({
                ...current,
                [scene.key]: nextModel,
              }));
              if (!sceneSupportsThinking(scene, nextModel)) {
                workspace.setThinkingSelections((current) => ({
                  ...current,
                  [scene.key]: false,
                }));
              }
            }}
            onSceneThinkingSelectionChange={(sceneKey, enabled) =>
              workspace.setThinkingSelections((current) => ({
                ...current,
                [sceneKey]: enabled,
              }))
            }
            onCategorySave={workspace.handleCategorySave}
            onRestoreCategoryScenes={workspace.handleRestoreCategoryScenes}
            onApplyBatch={workspace.handleApplyBatch}
            onSceneSave={workspace.handleSceneSave}
            onRestoreScene={workspace.handleRestoreScene}
            onJumpToObservability={workspace.jumpToObservability}
            onOpenVoiceSettings={() => workspace.setSettingsOpen(true)}
            onTestVoice={() => workspace.handleVoiceTest(false)}
          />
        </TabsContent>

        <TabsContent value="observability" className="space-y-4">
          <AiWorkspaceObservabilityTab
            logFilters={workspace.logFilters}
            logs={workspace.logs}
            logsLoading={workspace.logsLoading}
            onLogFilterChange={workspace.setLogFilters}
            onLoadLogs={() => workspace.loadLogs()}
            onOpenLogDetail={workspace.handleOpenLogDetail}
          />
        </TabsContent>
      </Tabs>

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
        settingsOpen={workspace.settingsOpen}
        savingKeys={workspace.savingKeys}
        onImpactOpenChange={workspace.setImpactOpen}
        onConnectionOpenChange={workspace.setConnectionOpen}
        onLogDetailOpenChange={workspace.setLogDetailOpen}
        onSettingsOpenChange={workspace.setSettingsOpen}
        onDeleteModel={workspace.handleDeleteModel}
        onTestVoice={() => workspace.handleVoiceTest(true)}
      />
    </div>
  );
}
