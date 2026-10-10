import { request } from '@/shared/api/http'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'
import type {
  PalaceEditorResponse,
  PalaceGroupedListResponse,
  PalaceQuizQuestion,
  PalaceSubjectShelfResponse,
  QuizNodeBindingEdge,
} from '@/shared/api/contracts'

/**
 * Palace and question text prepared while Memory Anki is starting, before the
 * window opens. Pages read this copy. English audio and subject images are not
 * included.
 *
 * Another device's edits appear the next time the startup script runs. Edits
 * made here show immediately, even if the save is still on its way.
 */

interface StudyTextLibraryResponse {
  editors: PalaceEditorResponse[]
  questions_by_palace: Record<string, PalaceQuizQuestion[]>
  bindings_by_palace: Record<string, QuizNodeBindingEdge[]>
  grouped: PalaceGroupedListResponse
  subjects: PalaceSubjectShelfResponse
  prepared_at?: string
}

interface StudyTextSnapshot {
  editors: Map<number, PalaceEditorResponse>
  questionsByPalace: Map<number, PalaceQuizQuestion[]>
  bindingsByPalace: Map<number, QuizNodeBindingEdge[]>
  grouped: PalaceGroupedListResponse | null
  subjects: PalaceSubjectShelfResponse | null
  preparedAt: string | null
}

const CATALOG_REFRESH_DELAYS_MS = [0, 500, 1500, 4000, 10000, 20000]

let snapshot: StudyTextSnapshot | null = null
let pending: Promise<StudyTextSnapshot> | null = null
let settled = false
let lastError: unknown = null
let catalogRefreshToken = 0
const pendingPatches: Array<(current: StudyTextSnapshot) => void> = []

function emptySnapshot(): StudyTextSnapshot {
  return {
    editors: new Map(),
    questionsByPalace: new Map(),
    bindingsByPalace: new Map(),
    grouped: null,
    subjects: null,
    preparedAt: null,
  }
}

function indexPayload(payload: StudyTextLibraryResponse): StudyTextSnapshot {
  const next = emptySnapshot()
  for (const editor of payload.editors || []) {
    const palaceId = editor.palace?.id
    if (typeof palaceId === 'number') next.editors.set(palaceId, editor)
  }
  for (const [palaceId, questions] of Object.entries(payload.questions_by_palace || {})) {
    const id = Number(palaceId)
    if (Number.isFinite(id)) next.questionsByPalace.set(id, questions || [])
  }
  for (const [palaceId, bindings] of Object.entries(payload.bindings_by_palace || {})) {
    const id = Number(palaceId)
    if (Number.isFinite(id)) next.bindingsByPalace.set(id, bindings || [])
  }
  for (const palaceId of next.editors.keys()) {
    if (!next.questionsByPalace.has(palaceId)) next.questionsByPalace.set(palaceId, [])
    if (!next.bindingsByPalace.has(palaceId)) next.bindingsByPalace.set(palaceId, [])
  }
  next.grouped = payload.grouped ?? null
  next.subjects = payload.subjects ?? null
  next.preparedAt = payload.prepared_at ?? null
  return next
}

function applyPatches(current: StudyTextSnapshot) {
  const patches = pendingPatches.splice(0, pendingPatches.length)
  for (const patch of patches) patch(current)
}

export function isStudyTextLibraryPending() {
  return pending != null && snapshot == null
}

export function ensureStudyTextLibrary() {
  if (snapshot) return Promise.resolve(snapshot)
  if (settled && !pending) {
    return Promise.reject(lastError ?? new Error('今天的文字没有准备好'))
  }
  if (!pending) {
    pending = request<StudyTextLibraryResponse>('/study-text-library')
      .then((payload) => {
        snapshot = indexPayload(payload)
        applyPatches(snapshot)
        settled = true
        lastError = null
        return snapshot
      })
      .catch((error) => {
        pending = null
        settled = true
        lastError = error
        throw error
      })
  }
  return pending
}

export function forgetPreparedCatalog() {
  if (!snapshot) return
  const token = ++catalogRefreshToken
  void pullNewerCatalog(snapshot.preparedAt, token, 0)
}

function pullNewerCatalog(previous: string | null, token: number, attempt: number) {
  request<StudyTextLibraryResponse>('/study-text-library')
    .then((payload) => {
      if (token !== catalogRefreshToken || !snapshot) return
      const preparedAt = payload.prepared_at ?? null
      if (preparedAt && preparedAt !== previous) {
        snapshot.grouped = payload.grouped ?? snapshot.grouped
        snapshot.subjects = payload.subjects ?? snapshot.subjects
        snapshot.preparedAt = preparedAt
        emitAppEvent(APP_EVENT_NAMES.palaceCatalogInvalidated)
        return
      }
      const nextAttempt = attempt + 1
      if (nextAttempt >= CATALOG_REFRESH_DELAYS_MS.length) return
      globalThis.setTimeout(
        () => pullNewerCatalog(previous, token, nextAttempt),
        CATALOG_REFRESH_DELAYS_MS[nextAttempt],
      )
    })
    .catch(() => {})
}

export function peekPalaceEditor(palaceId: number) {
  return snapshot?.editors.get(palaceId) ?? null
}

export function peekPalaceQuestions(palaceId: number) {
  if (!snapshot) return null
  if (!snapshot.questionsByPalace.has(palaceId) && !snapshot.editors.has(palaceId)) return null
  return snapshot.questionsByPalace.get(palaceId) ?? []
}

export function peekPalaceBindings(palaceId: number) {
  if (!snapshot) return null
  if (!snapshot.bindingsByPalace.has(palaceId) && !snapshot.editors.has(palaceId)) return null
  return snapshot.bindingsByPalace.get(palaceId) ?? []
}

export function peekGroupedPalaces() {
  return snapshot?.grouped ?? null
}

export function peekSubjectShelf() {
  return snapshot?.subjects ?? null
}

export function isDefaultCatalogQuery(params?: Record<string, string>) {
  if (!params) return true
  return Object.values(params).every((value) => !value)
}

function applyWhenReady(patch: (current: StudyTextSnapshot) => void) {
  if (snapshot) {
    patch(snapshot)
    return
  }
  if (!settled) pendingPatches.push(patch)
}

export function rememberPalaceEditor(palaceId: number, editor: PalaceEditorResponse) {
  applyWhenReady((current) => {
    current.editors.set(palaceId, editor)
  })
}

export function rememberPalaceEditorDraft(
  palaceId: number,
  draft: Partial<Pick<PalaceEditorResponse, 'editor_doc' | 'editor_config' | 'editor_local_config' | 'lang'>>,
) {
  applyWhenReady((current) => {
    const existing = current.editors.get(palaceId)
    if (!existing) return
    current.editors.set(palaceId, { ...existing, ...draft })
  })
}

export function rememberPalaceQuestion(question: PalaceQuizQuestion) {
  applyWhenReady((current) => {
    const palaceId = question.palace_id
    if (palaceId == null) return
    const replace = (items: PalaceQuizQuestion[]) => {
      const index = items.findIndex((item) => item.id === question.id)
      if (index < 0) return items
      return items.map((item, itemIndex) => (itemIndex === index ? question : item))
    }
    const owned = current.questionsByPalace.get(palaceId) ?? []
    const ownedIndex = owned.findIndex((item) => item.id === question.id)
    current.questionsByPalace.set(
      palaceId,
      ownedIndex < 0 ? [...owned, question] : replace(owned),
    )
    for (const [id, items] of current.questionsByPalace) {
      if (id === palaceId) continue
      if (items.some((item) => item.id === question.id)) {
        current.questionsByPalace.set(id, replace(items))
      }
    }
  })
}

export function forgetPalaceQuestion(questionId: number) {
  applyWhenReady((current) => {
    for (const [palaceId, items] of current.questionsByPalace) {
      if (items.some((item) => item.id === questionId)) {
        current.questionsByPalace.set(
          palaceId,
          items.filter((item) => item.id !== questionId),
        )
      }
    }
  })
}

export function rememberPalaceBindings(palaceId: number, items: QuizNodeBindingEdge[]) {
  applyWhenReady((current) => {
    current.bindingsByPalace.set(palaceId, items)
  })
}

export function resetStudyTextLibraryForTest() {
  catalogRefreshToken += 1
  snapshot = null
  pending = null
  settled = false
  lastError = null
  pendingPatches.splice(0, pendingPatches.length)
}

export function installStudyTextLibraryForTest(payload: StudyTextLibraryResponse) {
  snapshot = indexPayload(payload)
  pending = Promise.resolve(snapshot)
  settled = true
  applyPatches(snapshot)
}
