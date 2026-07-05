import type { MindMapEditorState } from '@/shared/api/contracts'

export interface ProgrammaticEditorApplyContext {
  source: 'import' | 'programmatic'
  jobId?: string | null
  applyMode?: 'replace' | 'append'
  sourceTitle?: string
  expectedFingerprint?: string | null
  expectedNodeCount?: number | null
}

interface ApplyProgrammaticEditorStateOptions<TResponse> {
  previousState: MindMapEditorState | null
  nextState: MindMapEditorState
  context?: ProgrammaticEditorApplyContext
  flushPendingSaves?: () => Promise<void>
  fingerprintEditorDocForValidation?: (value: MindMapEditorState['editor_doc']) => string
  beginProtectedWrite: (nextState: MindMapEditorState, context?: ProgrammaticEditorApplyContext) => void
  releaseProtectedWrite: () => void
  optimisticApply: (nextState: MindMapEditorState) => void
  rollback: (previousState: MindMapEditorState) => void
  adoptSavedState: (nextState: MindMapEditorState) => void
  save: () => Promise<TResponse>
  selectSavedEditorState: (response: TResponse) => MindMapEditorState
  afterSave?: (response: TResponse) => void
  reload: () => Promise<void>
  afterReload?: () => void
}

export function fingerprintEditorDoc(value: MindMapEditorState['editor_doc']) {
  try {
    return JSON.stringify(value ?? null) ?? 'null'
  } catch {
    return String(Date.now())
  }
}

export function countEditorDocNodes(value: MindMapEditorState['editor_doc']) {
  const visit = (node: unknown): number => {
    if (!node || typeof node !== 'object') return 0
    const children = Array.isArray((node as { children?: unknown[] }).children)
      ? (node as { children: unknown[] }).children
      : []
    return 1 + children.reduce<number>((total, child) => total + visit(child), 0)
  }
  const root =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { root?: unknown }).root
      : null
  return visit(root)
}

function validateSavedState(
  nextState: MindMapEditorState,
  context?: ProgrammaticEditorApplyContext,
  fingerprintForValidation: (value: MindMapEditorState['editor_doc']) => string = fingerprintEditorDoc,
) {
  if (!context) return
  if (context.expectedFingerprint) {
    const actualFingerprint = fingerprintForValidation(nextState.editor_doc)
    if (actualFingerprint !== context.expectedFingerprint) {
      throw new Error('保存后的脑图与预期不一致，已阻止显示成功结果。')
    }
  }
  if (context.expectedNodeCount != null) {
    const actualNodeCount = countEditorDocNodes(nextState.editor_doc)
    if (actualNodeCount < context.expectedNodeCount) {
      throw new Error('保存后的脑图知识点数少于预期，已阻止显示成功结果。')
    }
  }
}

export async function applyProgrammaticEditorState<TResponse>({
  previousState,
  nextState,
  context,
  flushPendingSaves,
  fingerprintEditorDocForValidation,
  beginProtectedWrite,
  releaseProtectedWrite,
  optimisticApply,
  rollback,
  adoptSavedState,
  save,
  selectSavedEditorState,
  afterSave,
  reload,
  afterReload,
}: ApplyProgrammaticEditorStateOptions<TResponse>) {
  await flushPendingSaves?.()
  beginProtectedWrite(nextState, context)
  optimisticApply(nextState)
  try {
    const response = await save()
    const savedState = selectSavedEditorState(response)
    validateSavedState(savedState, context, fingerprintEditorDocForValidation)
    afterSave?.(response)
    adoptSavedState(savedState)
    await reload()
    afterReload?.()
    return savedState
  } catch (error) {
    releaseProtectedWrite()
    try {
      await reload()
    } catch {
      if (previousState) {
        rollback(previousState)
      }
    }
    throw error
  }
}
