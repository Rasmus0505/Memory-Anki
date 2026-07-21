import { useCallback, useEffect, useMemo, useState } from 'react'
import { listMindMapNodeMasteryApi, setMindMapNodeLabelApi } from '@/entities/mindmap-learning'
import type { MindMapEditorState, MindMapTask } from '@/shared/api/contracts'
import { auditMindMapDocument, searchMindMapDocument } from '@/entities/mindmap-document'

interface UseMindMapExperienceOptions {
  entityType: 'palace' | 'subject'
  entityId: number | null
  editorState: MindMapEditorState | null
  defaultTask: MindMapTask
}

export function useMindMapExperience({ entityType, entityId, editorState, defaultTask }: UseMindMapExperienceOptions) {
  const taskStorageKey = entityId ? `memory-anki:mindmap-task:${entityType}:${entityId}` : null
  const [task, setTaskState] = useState<MindMapTask>(defaultTask)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSearchUid, setSelectedSearchUid] = useState<string | null>(null)
  const [masteryItems, setMasteryItems] = useState<Awaited<ReturnType<typeof listMindMapNodeMasteryApi>>['items']>([])

  useEffect(() => {
    if (!taskStorageKey) return
    const stored = localStorage.getItem(taskStorageKey)
    setTaskState(stored === 'build' || stored === 'learn' ? stored : defaultTask)
  }, [defaultTask, taskStorageKey])

  useEffect(() => {
    if (entityType !== 'palace' || !entityId) { setMasteryItems([]); return }
    let active = true
    void listMindMapNodeMasteryApi(entityId).then((response) => { if (active) setMasteryItems(response.items) }).catch(() => { if (active) setMasteryItems([]) })
    return () => { active = false }
  }, [entityId, entityType])

  const setTask = useCallback((nextTask: MindMapTask) => {
    setTaskState(nextTask)
    if (taskStorageKey) localStorage.setItem(taskStorageKey, nextTask)
  }, [taskStorageKey])

  const searchResults = useMemo(() => searchMindMapDocument(editorState?.editor_doc ?? null, searchQuery), [editorState?.editor_doc, searchQuery])
  const selectedResult = useMemo(() => searchResults.find((result) => result.nodeUid === selectedSearchUid) ?? searchResults[0] ?? null, [searchResults, selectedSearchUid])
  const structureIssues = useMemo(() => auditMindMapDocument(editorState?.editor_doc ?? null), [editorState?.editor_doc])
  const setNodeManualLabel = useCallback(async (nodeUid: string, label: 'weak' | 'mastered' | null) => {
    if (entityType !== 'palace' || !entityId) return
    await setMindMapNodeLabelApi(entityId, nodeUid, label)
    const response = await listMindMapNodeMasteryApi(entityId)
    setMasteryItems(response.items)
  }, [entityId, entityType])

  useEffect(() => {
    if (!searchQuery) setSelectedSearchUid(null)
    else if (searchResults.length && !searchResults.some((result) => result.nodeUid === selectedSearchUid)) setSelectedSearchUid(searchResults[0].nodeUid)
  }, [searchQuery, searchResults, selectedSearchUid])

  return {
    task,
    setTask,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedResult,
    selectSearchResult: setSelectedSearchUid,
    highlightedNodeUids: selectedResult ? [selectedResult.nodeUid] : [],
    structureIssues,
    masteryItems,
    masteryByNodeUid: Object.fromEntries(masteryItems.map((item) => [item.node_uid, {
      status: item.status,
      manualLabel: item.manual_label,
      masteryScore: item.mastery_score,
    }])),
    weakItems: masteryItems.filter((item) => (item.status === 'weak' || item.status === 'reinforce') && !item.hidden_by_mastered),
    setNodeManualLabel,
  }
}


