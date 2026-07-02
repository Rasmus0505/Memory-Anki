const hostId = new URLSearchParams(window.location.search).get('host')
const KEYBOARD_FOCUS_CLASS = 'memory-anki-keyboard-focus'
const focusState = {
  committedNodeUid: null,
  visualFocusNodeUid: null,
  editingNodeUid: null,
  mode: 'navigating',
}
const segmentState = {
  toolbarReady: false,
  menuOpen: false,
  nodeUidToSegment: new Map(),
  nodeParentToChildren: new Map(),
  nodeChildToParent: new Map(),
}
const reviewFxState = {
  activeTimers: new Set(),
  activeNodeClasses: new Map(),
  activeLineClasses: new Map(),
}
const feedbackState = {
  lastEventAtByKey: new Map(),
}
const immersiveToggleState = {
  nativeFullscreenRegistered: false,
  parentFullscreenActive: false,
}
const interactionState = {
  pointerDownNodeUid: null,
  pointerDownWithModifier: false,
  pointerIntentClearTimer: null,
  lastHoveredNodeUid: null,
}
const readonlyNodeClickBridgeState = {
  lastToken: '',
  lastAt: 0,
  lastSource: '',
  lastDomToken: '',
  lastDomAt: 0,
}
const uiChromeState = {
  cleared: false,
}
const bilinkState = {
  listenerRegistered: false,
  pendingInsertion: null,
}
const aiSplitToolbarState = {
  observerRegistered: false,
  patchScheduled: false,
}
const SELECTION_DRAG_ROOT_PARENT_KEY = '__memory_anki_selection_drag_root__'
const SELECTION_DRAG_HOLD_DELAY = 280
const SELECTION_DRAG_ACTIVATION_DISTANCE = 10
const SELECTION_DRAG_PRE_HOLD_TOLERANCE = 8
const SELECTION_DRAG_SLOT_MIN_HEIGHT = 16
const SELECTION_DRAG_SLOT_Y_EXPANSION = 6
const SELECTION_DRAG_SLOT_X_EXPANSION = 24
const SELECTION_DRAG_HISTORY_LIMIT = 20
const selectionHistoryProbeState = {
  token: 0,
}
const selectionDragHistoryState = {
  undoStack: [],
  redoStack: [],
  pendingEntry: null,
  nextEntryId: 1,
  applyingSnapshot: false,
  pendingFocusSnapshot: null,
}
const selectionDragState = {
  pointerId: null,
  pointerButton: null,
  pointerCaptureElement: null,
  ownsPointerSequence: false,
  stage: 'idle',
  holdTimer: null,
  holdReady: false,
  contextMenuBlockUntil: 0,
  sourceNodeUid: null,
  sourceParentUid: null,
  sourceSiblingUids: [],
  sourceElement: null,
  sourceRange: null,
  sourceText: '',
  sourceRect: null,
  sourceNodeRect: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  previewTargetNodeUid: null,
  previewTargetMode: 'cancel',
  previewInsertionBarRect: null,
  previewProxyRect: null,
  dimmedNodeUids: [],
  dimmedLineNodes: [],
  dropIntent: {
    mode: 'cancel',
    anchorUid: null,
    parentUid: null,
    slotRect: null,
    highlightUid: null,
  },
  pendingCreation: null,
}
const SOFT_SYNC_BUSY_WINDOW = 120
const SOFT_SYNC_MAX_DEFER_MS = 600
const syncState = {
  lastInteractionAt: 0,
  pendingSoftPayload: null,
  flushTimer: null,
  maxFlushTimer: null,
  pendingViewFitAfterRender: false,
  pendingFocusRestore: null,
  pendingViewMemoryFocusRestore: null,
  pendingFocusRequest: null,
  initialHydrationComplete: false,
  lastServerSyncedFingerprint: '',
}
const viewportRefreshState = {
  lastSizeSignature: '',
  scheduled: false,
  fitRequested: false,
}
const paperLayoutReflowState = {
  scheduled: false,
  inFlight: false,
  queuedFingerprint: '',
  requestedFingerprint: '',
  completedFingerprint: '',
}
const viewMemoryState = {
  snapshots: new Map(),
  pendingRestore: null,
}

function cloneValue(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

function normalizeViewMemoryScope(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function getCurrentViewMemoryScope() {
  return normalizeViewMemoryScope(window.__memoryAnkiHostState?.viewMemoryScope)
}

function captureViewMemoryScopeSnapshot() {
  const mindMap = window.__memoryAnkiMindMapInstance
  if (!mindMap) return null
  let transform = null
  try {
    if (mindMap.view && typeof mindMap.view.getTransformData === 'function') {
      transform = cloneValue(mindMap.view.getTransformData())
    }
  } catch (error) {
    console.warn(error)
  }
  const activeNode = getRenderer()?.activeNodeList?.[0] || null
  const activeNodeUid = getNodeUid(activeNode)
  const committedNodeUid = activeNodeUid || focusState.committedNodeUid || null
  const visualFocusNodeUid =
    focusState.visualFocusNodeUid || committedNodeUid || null
  if (!transform && !committedNodeUid && !visualFocusNodeUid) {
    return null
  }
  return {
    transform,
    committedNodeUid,
    visualFocusNodeUid,
  }
}

function saveViewMemoryScopeSnapshot(scope) {
  const normalizedScope = normalizeViewMemoryScope(scope)
  if (!normalizedScope) return false
  const snapshot = captureViewMemoryScopeSnapshot()
  if (!snapshot) return false
  viewMemoryState.snapshots.set(normalizedScope, snapshot)
  return true
}

function queueViewMemoryScopeRestore(scope) {
  const normalizedScope = normalizeViewMemoryScope(scope)
  if (!normalizedScope) {
    viewMemoryState.pendingRestore = null
    return false
  }
  const snapshot = viewMemoryState.snapshots.get(normalizedScope)
  if (!snapshot) {
    viewMemoryState.pendingRestore = null
    return false
  }
  viewMemoryState.pendingRestore = cloneValue(snapshot)
  return true
}

function consumePendingViewMemoryScopeRestore() {
  const snapshot = viewMemoryState.pendingRestore
  viewMemoryState.pendingRestore = null
  return snapshot ? cloneValue(snapshot) : null
}

function buildEmptySelectionDragIntent() {
  return {
    mode: 'cancel',
    anchorUid: null,
    parentUid: null,
    slotRect: null,
    highlightUid: null,
  }
}

function hasMeaningfulSelectionDragText(text) {
  return /\S/.test(String(text || '').replace(/\u00a0/g, ' '))
}

function buildEditorStateFingerprint(editorState, preserveView = false) {
  if (!editorState || typeof editorState !== 'object') return ''
  return JSON.stringify({
    editor_doc: cloneValue(editorState.editor_doc) || {},
    editor_config: cloneValue(editorState.editor_config) || {},
    editor_local_config: cloneValue(editorState.editor_local_config) || {},
    lang: editorState.lang || 'zh',
    preserveView: Boolean(preserveView),
  })
}

function markLastAppliedEditorFingerprint(nextFingerprint, syncIntent = 'full') {
  if (typeof nextFingerprint !== 'string' || nextFingerprint.length === 0) return
  window.__memoryAnkiLastAppliedEditorFingerprint = nextFingerprint
  if (syncIntent === 'replace' || syncIntent === 'full') {
    window.__memoryAnkiLastAppliedFullEditorFingerprint = nextFingerprint
  }
}

function markInitialHydrationComplete(nextFingerprint) {
  syncState.initialHydrationComplete = true
  if (typeof nextFingerprint === 'string' && nextFingerprint.length > 0) {
    syncState.lastServerSyncedFingerprint = nextFingerprint
  }
  try {
    getHostBridge()?.notify?.('initial_hydration_complete', {
      fingerprint: typeof nextFingerprint === 'string' ? nextFingerprint : '',
    })
  } catch (error) {
    console.warn(error)
  }
}

function getPreferredHostEditorStateSnapshot() {
  const pendingEditorState = window.__memoryAnkiPendingEditorState?.editorState
  if (pendingEditorState && typeof pendingEditorState === 'object') {
    return {
      editor_doc: cloneValue(pendingEditorState.editor_doc) || {},
      editor_config: cloneValue(pendingEditorState.editor_config) || {},
      editor_local_config: cloneValue(pendingEditorState.editor_local_config) || {},
      lang: pendingEditorState.lang || 'zh',
    }
  }
  return {
    editor_doc: cloneValue(getHostBridge()?.getMindMapData?.()) || {},
    editor_config: cloneValue(getHostBridge()?.getMindMapConfig?.()) || {},
    editor_local_config: cloneValue(getHostBridge()?.getLocalConfig?.()) || {},
    lang: getHostBridge()?.getLanguage?.() || 'zh',
  }
}

function updatePendingEditorStateBaseline(overrides = {}) {
  const currentPendingState = window.__memoryAnkiPendingEditorState || {}
  const baselineState =
    currentPendingState.editorState && typeof currentPendingState.editorState === 'object'
      ? cloneValue(currentPendingState.editorState)
      : getPreferredHostEditorStateSnapshot()
  const nextEditorState = {
    editor_doc:
      Object.prototype.hasOwnProperty.call(overrides, 'editor_doc')
        ? cloneValue(overrides.editor_doc) || {}
        : cloneValue(baselineState.editor_doc) || {},
    editor_config:
      Object.prototype.hasOwnProperty.call(overrides, 'editor_config')
        ? cloneValue(overrides.editor_config) || {}
        : cloneValue(baselineState.editor_config) || {},
    editor_local_config:
      Object.prototype.hasOwnProperty.call(overrides, 'editor_local_config')
        ? cloneValue(overrides.editor_local_config) || {}
        : cloneValue(baselineState.editor_local_config) || {},
    lang:
      Object.prototype.hasOwnProperty.call(overrides, 'lang')
        ? overrides.lang || 'zh'
        : baselineState.lang || 'zh',
  }
  const preserveView = Boolean(currentPendingState.preserveView)
  window.__memoryAnkiPendingEditorState = {
    ...currentPendingState,
    editorState: nextEditorState,
    preserveView,
    syncIntent: currentPendingState.syncIntent === 'replace' ? 'replace' : 'soft',
    viewPolicy: currentPendingState.viewPolicy === 'reset' ? 'reset' : 'preserve',
    fingerprint: buildEditorStateFingerprint(nextEditorState, preserveView),
  }
  return nextEditorState
}

function canWriteBackToHost() {
  if (isReadonlyHost()) return false
  if (syncState.initialHydrationComplete) return true
  return Boolean(getHostBridge()?.isHydrated?.())
}

function stableSerialize(value) {
  try {
    return JSON.stringify(value) || ''
  } catch (error) {
    console.warn(error)
    return ''
  }
}

function getEditorDocRoot(doc) {
  return doc && typeof doc === 'object' && doc.root && typeof doc.root === 'object'
    ? doc.root
    : null
}

function getDocNodeData(node) {
  return node && typeof node === 'object' && node.data && typeof node.data === 'object'
    ? node.data
    : {}
}

function getDocNodeIdentity(node) {
  const data = getDocNodeData(node)
  if (typeof data.uid === 'string' && data.uid.trim().length > 0) return `uid:${data.uid.trim()}`
  if (data.memoryAnkiId != null && String(data.memoryAnkiId).trim().length > 0) {
    return `memoryAnkiId:${String(data.memoryAnkiId).trim()}`
  }
  if (
    typeof data.memoryAnkiNodeType === 'string' &&
    data.memoryAnkiNodeType.trim().length > 0
  ) {
    return `nodeType:${data.memoryAnkiNodeType.trim()}`
  }
  return null
}

function getDocNodeChildren(node) {
  return Array.isArray(node?.children) ? node.children : []
}

function areDocsEquivalentForSoftSync(currentNode, nextNode, isRoot = false) {
  if (!currentNode || !nextNode) return false
  if (!isRoot) {
    if (getDocNodeIdentity(currentNode) !== getDocNodeIdentity(nextNode)) return false
  }
  const currentChildren = getDocNodeChildren(currentNode)
  const nextChildren = getDocNodeChildren(nextNode)
  if (currentChildren.length !== nextChildren.length) return false
  for (let index = 0; index < currentChildren.length; index += 1) {
    if (!areDocsEquivalentForSoftSync(currentChildren[index], nextChildren[index], false)) {
      return false
    }
  }
  return true
}

function canSoftMergeEditorState(nextEditorState) {
  if (!nextEditorState || typeof nextEditorState !== 'object') return false
  const currentDoc = getCurrentEditorDocSnapshot()
  const currentRoot = getEditorDocRoot(currentDoc)
  const nextRoot = getEditorDocRoot(nextEditorState.editor_doc)
  if (!currentRoot || !nextRoot) return false
  const currentConfig = getHostBridge()?.getMindMapConfig?.() || {}
  const currentLocalConfig = getHostBridge()?.getLocalConfig?.() || {}
  const currentLang = getHostBridge()?.getLanguage?.() || 'zh'
  if (stableSerialize(currentConfig) !== stableSerialize(nextEditorState.editor_config || {})) return false
  if (stableSerialize(currentLocalConfig) !== stableSerialize(nextEditorState.editor_local_config || {})) return false
  if (String(currentLang || 'zh') !== String(nextEditorState.lang || 'zh')) return false
  return areDocsEquivalentForSoftSync(currentRoot, nextRoot, true)
}

function getHostBridge() {
  const registry = window.parent && window.parent.__memoryAnkiMindMapHosts
  if (!registry || !hostId) return null
  return registry[hostId] || null
}

function getMindMap() {
  return window.__memoryAnkiMindMapInstance || null
}

function getRenderer() {
  return getMindMap()?.renderer || null
}

function isReadonlyHost() {
  return Boolean(window.__memoryAnkiHostState?.readonly)
}

function isEditableElement(element) {
  if (!element) return false
  const tagName = element.tagName
  if (tagName === 'TEXTAREA') return true
  if (tagName === 'INPUT') {
    const type = String(element.getAttribute('type') || 'text').toLowerCase()
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)
  }
  if (typeof element.isContentEditable === 'boolean' && element.isContentEditable) return true
  return false
}

function getSelectionEditableElement() {
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0) return null

  let node = selection.anchorNode || selection.focusNode || null
  if (!node) return null
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement
  }

  let element = node instanceof Element ? node : null
  while (element) {
    if (isEditableElement(element)) return element
    element = element.parentElement
  }
  return null
}

function getActiveEditableElement() {
  if (isEditableElement(document.activeElement)) {
    return document.activeElement
  }
  return getSelectionEditableElement()
}

function markHostInteraction() {
  syncState.lastInteractionAt = Date.now()
}

function clearPendingSoftSyncTimers() {
  if (syncState.flushTimer != null) {
    window.clearTimeout(syncState.flushTimer)
    syncState.flushTimer = null
  }
  if (syncState.maxFlushTimer != null) {
    window.clearTimeout(syncState.maxFlushTimer)
    syncState.maxFlushTimer = null
  }
}

function isSoftSyncBusy() {
  if (selectionDragState.stage === 'pending' || selectionDragState.stage === 'dragging') {
    return true
  }
  if (getActiveEditableElement()) {
    return true
  }
  return Date.now() - Number(syncState.lastInteractionAt || 0) < SOFT_SYNC_BUSY_WINDOW
}

function focusKeyboardSurface() {
  const surface = document.getElementById('app') || document.body
  if (!(surface instanceof HTMLElement)) return
  if (!surface.hasAttribute('tabindex')) {
    surface.setAttribute('tabindex', '-1')
  }
  surface.focus({ preventScroll: true })
}

function releaseEditableFocus() {
  const editableElement = getActiveEditableElement()
  if (editableElement instanceof HTMLElement && typeof editableElement.blur === 'function') {
    editableElement.blur()
  }
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  selection?.removeAllRanges?.()
  focusState.mode = 'navigating'
  focusState.editingNodeUid = null
  focusKeyboardSurface()
  markHostInteraction()
}

function dispatchEditableInputEvent(element) {
  if (!element) return
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      data: '\n',
      inputType: 'insertLineBreak',
    })
  )
}

function insertLineBreakIntoEditable(element = getActiveEditableElement()) {
  if (!element) return false

  if (element.tagName === 'TEXTAREA') {
    const start = typeof element.selectionStart === 'number' ? element.selectionStart : element.value.length
    const end = typeof element.selectionEnd === 'number' ? element.selectionEnd : element.value.length
    element.setRangeText('\n', start, end, 'end')
    dispatchEditableInputEvent(element)
    return true
  }

  if (typeof document.execCommand === 'function') {
    if (document.execCommand('insertText', false, '\n')) {
      dispatchEditableInputEvent(element)
      return true
    }
    if (document.execCommand('insertLineBreak')) {
      dispatchEditableInputEvent(element)
      return true
    }
  }

  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0) return false

  const range = selection.getRangeAt(0)
  range.deleteContents()
  const breakNode = document.createTextNode('\n')
  range.insertNode(breakNode)
  range.setStartAfter(breakNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  dispatchEditableInputEvent(element)
  return true
}

function syncKeyboardMode() {
  focusState.mode = getActiveEditableElement() ? 'editing' : 'navigating'
  if (focusState.mode !== 'editing') {
    focusState.editingNodeUid = null
  }
}

function maybeFlushSoftSyncOnIdle() {
  window.setTimeout(() => {
    flushPendingSoftSync()
  }, 0)
}

function buildCurrentLocalEditorStateSnapshot() {
  const pendingEditorState = window.__memoryAnkiPendingEditorState?.editorState
  return {
    editor_doc:
      cloneValue(getCurrentEditorDocSnapshot()) ||
      cloneValue(pendingEditorState?.editor_doc) ||
      {},
    editor_config:
      cloneValue(getHostBridge()?.getMindMapConfig?.()) ||
      cloneValue(pendingEditorState?.editor_config) ||
      {},
    editor_local_config:
      cloneValue(getHostBridge()?.getLocalConfig?.()) ||
      cloneValue(pendingEditorState?.editor_local_config) ||
      {},
    lang:
      getHostBridge()?.getLanguage?.() ||
      pendingEditorState?.lang ||
      'zh',
  }
}

function shouldDiscardStalePendingSoftPayload(payload) {
  if (!payload || (payload.syncIntent || 'soft') !== 'soft') return false
  const nextEditorState = payload.editorState
  if (!nextEditorState || typeof nextEditorState !== 'object') return false
  const payloadFingerprint =
    payload.fingerprint ||
    buildEditorStateFingerprint(nextEditorState, Boolean(payload.preserveView))
  const currentLocalFingerprint = buildEditorStateFingerprint(
    buildCurrentLocalEditorStateSnapshot(),
    Boolean(payload.preserveView),
  )
  return (
    currentLocalFingerprint.length > 0 &&
    payloadFingerprint.length > 0 &&
    currentLocalFingerprint !== payloadFingerprint
  )
}

function isImmediateSoftSyncReason(reason) {
  return reason === 'review_flip'
}

function defaultMindMapShortcutTargetCheck(event, mindMap) {
  const target = event?.target
  if (target === document.body) return true
  const editNodeClassList = Array.isArray(mindMap?.editNodeClassList)
    ? mindMap.editNodeClassList
    : []
  if (!(target instanceof Element)) return false
  return editNodeClassList.some(className => target.classList.contains(className))
}

function ensureMindMapShortcutGuard() {
  const mindMap = window.__memoryAnkiMindMapInstance
  if (!mindMap?.opt) return

  if (mindMap.opt.customCheckEnableShortcut === mindMap.__memoryAnkiShortcutGuard) {
    return
  }

  const existingCheck = mindMap.opt.customCheckEnableShortcut
  mindMap.__memoryAnkiShortcutGuardBaseCheck =
    typeof existingCheck === 'function' &&
    existingCheck !== mindMap.__memoryAnkiShortcutGuard
      ? existingCheck
      : null

  mindMap.__memoryAnkiShortcutGuard = event => {
    if (getActiveEditableElement()) return false

    if (typeof mindMap.__memoryAnkiShortcutGuardBaseCheck === 'function') {
      return mindMap.__memoryAnkiShortcutGuardBaseCheck(event)
    }

    return defaultMindMapShortcutTargetCheck(event, mindMap)
  }

  mindMap.opt.customCheckEnableShortcut = mindMap.__memoryAnkiShortcutGuard
}

function getNodeData(node) {
  if (!node || typeof node.getData !== 'function') return {}
  try {
    const whole = node.getData()
    if (whole && typeof whole === 'object') return whole
  } catch (error) {
    console.warn(error)
  }
  const keys = ['text', 'note', 'uid', 'memoryAnkiId', 'memoryAnkiNodeType']
  return keys.reduce((acc, key) => {
    try {
      acc[key] = node.getData(key)
    } catch (error) {
      acc[key] = null
    }
    return acc
  }, {})
}

function getNodeUid(node) {
  if (!node) return null
  if (typeof node.uid === 'string') return node.uid
  const uid = typeof node.getData === 'function' ? node.getData('uid') : null
  return typeof uid === 'string' ? uid : null
}

function getHostSegments() {
  const segments = window.__memoryAnkiHostState?.segments
  return Array.isArray(segments) ? segments : []
}

function getActiveSegmentId() {
  const raw = window.__memoryAnkiHostState?.activeSegmentId
  return typeof raw === 'number' ? raw : raw == null ? null : Number(raw)
}

function getSegmentColorMode() {
  return window.__memoryAnkiHostState?.segmentColorMode || 'all'
}

function getSegmentRangeDraft() {
  const rawDraft = window.__memoryAnkiHostState?.segmentRangeDraft
  const normalized = rawDraft && typeof rawDraft === 'object' ? rawDraft : {}
  return {
    active: Boolean(normalized.active),
    targetSegmentId:
      normalized.targetSegmentId === 'new'
        ? 'new'
        : normalized.targetSegmentId == null || normalized.targetSegmentId === ''
          ? null
          : Number(normalized.targetSegmentId),
    selectedNodeUids: Array.isArray(normalized.selectedNodeUids)
      ? normalized.selectedNodeUids.map(value => String(value))
      : [],
    overriddenConflictNodeUids: Array.isArray(normalized.overriddenConflictNodeUids)
      ? normalized.overriddenConflictNodeUids.map(value => String(value))
      : [],
  }
}

function getMiniPalaceDraft() {
  const rawDraft = window.__memoryAnkiHostState?.miniPalaceDraft
  const normalized = rawDraft && typeof rawDraft === 'object' ? rawDraft : {}
  return {
    active: Boolean(normalized.active),
    selectedNodeUids: Array.isArray(normalized.selectedNodeUids)
      ? normalized.selectedNodeUids.map(value => String(value)).filter(Boolean)
      : [],
  }
}

function getBilinkCounts() {
  const raw = window.__memoryAnkiHostState?.bilinkCounts
  return raw && typeof raw === 'object' ? raw : {}
}

function getBilinkItems() {
  const raw = window.__memoryAnkiHostState?.bilinkItems
  return Array.isArray(raw) ? raw : []
}

function getFocusNodeUids() {
  const raw = window.__memoryAnkiHostState?.focusNodeUids
  return Array.isArray(raw) ? raw.map(value => String(value)).filter(Boolean) : []
}

function getCurrentPalaceId() {
  const raw = window.__memoryAnkiHostState?.bilinkCurrentPalaceId
  return typeof raw === 'number' ? raw : raw == null ? null : Number(raw)
}

function getCachedNodes() {
  const renderer = getRenderer()
  if (!renderer?.nodeCache) return []
  return Object.values(renderer.nodeCache).filter(Boolean)
}

function getNodeByUid(uid) {
  if (!uid) return null
  return getRenderer()?.nodeCache?.[uid] || null
}

function collectInteractionTargets(target, event) {
  const targets = []
  const seen = new Set()
  function appendTargetWithAncestors(candidate) {
    let current = candidate || null
    while (current) {
      if (!seen.has(current)) {
        seen.add(current)
        targets.push(current)
      }
      if (current.assignedSlot) {
        current = current.assignedSlot
        continue
      }
      if (current.parentNode) {
        current = current.parentNode
        continue
      }
      current = current.host || null
    }
  }
  appendTargetWithAncestors(target)
  const path =
    event && typeof event.composedPath === 'function' ? event.composedPath() : []
  path.forEach(candidate => {
    appendTargetWithAncestors(candidate)
  })
  return targets
}

function getElementFromInteractionTarget(target) {
  if (!target) return null
  if (target instanceof Element) return target
  if (target.nodeType === Node.TEXT_NODE) {
    return target.parentElement || null
  }
  if (target.ownerSVGElement instanceof SVGElement) {
    return target.ownerSVGElement
  }
  return null
}

function getNodeElementFromInteractionTarget(target, event) {
  const candidates = collectInteractionTargets(target, event)
  for (const candidate of candidates) {
    const element = getElementFromInteractionTarget(candidate)
    if (!element || typeof element.closest !== 'function') continue
    const nodeElement = element.closest('.smm-node')
    if (nodeElement) return nodeElement
  }
  return null
}

function getReadonlyFallbackNode(nodeElement) {
  if (!nodeElement) return null
  const activeNode = getCurrentActiveNode()
  if (activeNode?.group?.node && activeNode.group.node === nodeElement) {
    return activeNode
  }
  const visualFocusNode = resolveClosestExistingNode(focusState.visualFocusNodeUid)
  if (visualFocusNode?.group?.node && visualFocusNode.group.node === nodeElement) {
    return visualFocusNode
  }
  const committedNode = resolveClosestExistingNode(focusState.committedNodeUid)
  if (committedNode?.group?.node && committedNode.group.node === nodeElement) {
    return committedNode
  }
  return activeNode || visualFocusNode || committedNode || null
}

function getNodeByElement(target, options = {}) {
  const nodeElement = getNodeElementFromInteractionTarget(target, options.event)
  if (!nodeElement) return null
  const nodes = getCachedNodes()
  const directMatch =
    nodes.find(node => node?.group?.node === nodeElement) ||
    nodes.find(node => node?.group?.node?.contains?.(nodeElement)) ||
    null
  if (directMatch) return directMatch
  if (typeof nodeElement.getBoundingClientRect !== 'function') {
    return options.allowReadonlyFallback ? getReadonlyFallbackNode(nodeElement) : null
  }
  const rect = nodeElement.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const rectMatch =
    nodes.find(node => {
      const nodeRect =
        typeof node?.group?.node?.getBoundingClientRect === 'function'
          ? node.group.node.getBoundingClientRect()
          : null
      if (!nodeRect) return false
      const deltaX = Math.abs(nodeRect.left + nodeRect.width / 2 - centerX)
      const deltaY = Math.abs(nodeRect.top + nodeRect.height / 2 - centerY)
      return deltaX <= 2 && deltaY <= 2
    }) || null
  if (rectMatch) return rectMatch
  if (options.allowReadonlyFallback) {
    return getReadonlyFallbackNode(nodeElement)
  }
  return null
}

function notifyNodeActive(node) {
  if (!node) return
  getHostBridge()?.notify?.('node_active', [serializeNode(node)])
}

function notifyCurrentFocusNodeActive() {
  const node = getCurrentActiveNode()
  if (!node) return false
  notifyNodeActive(node)
  return true
}

function isMeaningfulClientRect(rect) {
  return Boolean(rect && (rect.width > 0 || rect.height > 0 || rect.left || rect.top))
}

function getEditableInteractionRect(editableElement = getActiveEditableElement()) {
  const editableRect = editableElement?.getBoundingClientRect?.() || null
  if (isMeaningfulClientRect(editableRect)) {
    return editableRect
  }
  const activeNode =
    (focusState.editingNodeUid ? getNodeByUid(focusState.editingNodeUid) : null) ||
    getCurrentActiveNode()
  const nodeRect = getNodeRect(activeNode)
  if (isMeaningfulClientRect(nodeRect)) {
    return nodeRect
  }
  return null
}

function getNodeEditableElement(nodeOrUid) {
  const nodeElement = getNodeElement(nodeOrUid)
  if (!nodeElement) return null
  return (
    nodeElement.querySelector?.('.ql-editor, [contenteditable="true"], textarea, input') || null
  )
}

function getSelectionDragCandidateContext(eventTarget, clientX, clientY) {
  const editingNode =
    (focusState.editingNodeUid ? getNodeByUid(focusState.editingNodeUid) : null) ||
    getCurrentActiveNode() ||
    null
  const editingNodeUid = getNodeUid(editingNode)
  const editingEditable = editingNodeUid ? getNodeEditableElement(editingNodeUid) : null
  const editingNodeRect = getNodeRect(editingNode)
  const targetNode = getNodeByElement(eventTarget)
  const targetNodeUid = getNodeUid(targetNode)
  const targetEditable = targetNodeUid ? getNodeEditableElement(targetNodeUid) : null

  const candidates = [
    {
      node: editingNode,
      editableElement: editingEditable,
      nodeRect: editingNodeRect,
      priority: 0,
    },
    {
      node: targetNode,
      editableElement: targetEditable,
      nodeRect: getNodeRect(targetNode),
      priority: 1,
    },
    {
      node: null,
      editableElement: getActiveEditableElement(),
      nodeRect: null,
      priority: 2,
    },
  ]

  for (const candidate of candidates) {
    const editableElement = candidate.editableElement
    if (!editableElement) continue
    const selectionText = getEditableSelectionTextForElement(editableElement)
    if (!selectionText || !hasMeaningfulSelectionDragText(selectionText)) continue
    if (!isSelectionInsideEditable(editableElement)) continue
    const selectionRange = getSelectionRangeSnapshotForElement(editableElement)
    if (!selectionRange) continue
    const selectionRect = getEditableSelectionRect(editableElement)
    const editableRect = getEditableInteractionRect(editableElement)
    const nodeRect = candidate.nodeRect || getNodeRect(candidate.node) || editableRect
    const canStartFromCurrentPointer =
      pointInRect(selectionRect, clientX, clientY) ||
      pointInRect(editableRect, clientX, clientY) ||
      pointInRect(nodeRect, clientX, clientY)
    if (!canStartFromCurrentPointer) continue
    return {
      editableElement,
      selectionText,
      selectionRange,
      selectionRect,
      sourceNode: candidate.node || targetNode || editingNode || getCurrentActiveNode(),
    }
  }

  return null
}

function resolveSelectionDragSourceElement() {
  const currentSourceElement = selectionDragState.sourceElement
  if (currentSourceElement && document.contains(currentSourceElement)) {
    return currentSourceElement
  }
  const sourceElement =
    getNodeEditableElement(selectionDragState.sourceNodeUid) ||
    getActiveEditableElement() ||
    null
  if (sourceElement) {
    selectionDragState.sourceElement = sourceElement
  }
  return sourceElement
}

function getEditableSelectionRect() {
  const editableElement = arguments.length > 0 ? arguments[0] : getActiveEditableElement()
  if (editableElement && (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT')) {
    const start =
      typeof editableElement.selectionStart === 'number' ? editableElement.selectionStart : 0
    const end =
      typeof editableElement.selectionEnd === 'number' ? editableElement.selectionEnd : start
    if (end > start) {
      return getEditableInteractionRect(editableElement)
    }
  }
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect?.()
  if (isMeaningfulClientRect(rect)) {
    return rect
  }
  return getEditableInteractionRect(editableElement)
}

function getEditableSelectionTextForElement(editableElement) {
  if (!editableElement) return ''
  if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
    const value = String(editableElement.value || '')
    const start =
      typeof editableElement.selectionStart === 'number' ? editableElement.selectionStart : 0
    const end =
      typeof editableElement.selectionEnd === 'number' ? editableElement.selectionEnd : start
    if (end > start) {
      return value.slice(start, end)
    }
    return ''
  }
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0 || selection.isCollapsed) return ''
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  const containsAnchor = anchorNode ? editableElement.contains(anchorNode) : false
  const containsFocus = focusNode ? editableElement.contains(focusNode) : false
  if (!containsAnchor && !containsFocus) return ''
  return String(selection.toString() || '')
}

function getEditableSelectionText() {
  return getEditableSelectionTextForElement(getActiveEditableElement())
}

function getContentEditableSelectionOffsets(editableElement, range) {
  if (!editableElement || !(range instanceof Range)) return null
  try {
    const startRange = document.createRange()
    startRange.selectNodeContents(editableElement)
    startRange.setEnd(range.startContainer, range.startOffset)
    const endRange = document.createRange()
    endRange.selectNodeContents(editableElement)
    endRange.setEnd(range.endContainer, range.endOffset)
    const start = startRange.toString().length
    const end = endRange.toString().length
    if (end <= start) return null
    return { start, end }
  } catch (error) {
    console.warn(error)
    return null
  }
}

function getContentEditableTextPosition(editableElement, rawOffset) {
  if (!editableElement) return null
  const targetOffset = Math.max(0, Number(rawOffset) || 0)
  const walker = document.createTreeWalker(editableElement, NodeFilter.SHOW_TEXT)
  let currentNode = walker.nextNode()
  let remaining = targetOffset
  let lastTextNode = null
  while (currentNode) {
    const textLength = currentNode.textContent?.length || 0
    lastTextNode = currentNode
    if (remaining <= textLength) {
      return {
        container: currentNode,
        offset: remaining,
      }
    }
    remaining -= textLength
    currentNode = walker.nextNode()
  }
  if (lastTextNode) {
    return {
      container: lastTextNode,
      offset: lastTextNode.textContent?.length || 0,
    }
  }
  return {
    container: editableElement,
    offset: 0,
  }
}

function createContentEditableRangeFromOffsets(editableElement, snapshot) {
  if (!editableElement || !snapshot) return null
  const start = typeof snapshot.start === 'number' ? snapshot.start : null
  const end = typeof snapshot.end === 'number' ? snapshot.end : null
  if (start == null || end == null || end <= start) return null
  const startPosition = getContentEditableTextPosition(editableElement, start)
  const endPosition = getContentEditableTextPosition(editableElement, end)
  if (!startPosition || !endPosition) return null
  try {
    const range = document.createRange()
    range.setStart(startPosition.container, startPosition.offset)
    range.setEnd(endPosition.container, endPosition.offset)
    return range
  } catch (error) {
    console.warn(error)
    return null
  }
}

function getSelectionRangeSnapshotForElement(editableElement) {
  if (!editableElement) return null
  if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
    const start =
      typeof editableElement.selectionStart === 'number' ? editableElement.selectionStart : 0
    const end =
      typeof editableElement.selectionEnd === 'number' ? editableElement.selectionEnd : start
    if (end <= start) return null
    return { start, end }
  }
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0 || selection.isCollapsed) return null
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  const containsAnchor = anchorNode ? editableElement.contains(anchorNode) : false
  const containsFocus = focusNode ? editableElement.contains(focusNode) : false
  if (!containsAnchor && !containsFocus) return null
  try {
    return getContentEditableSelectionOffsets(
      editableElement,
      selection.getRangeAt(0).cloneRange(),
    )
  } catch (error) {
    console.warn(error)
    return null
  }
}

function getSelectionRangeSnapshot() {
  return getSelectionRangeSnapshotForElement(getActiveEditableElement())
}

function areSelectionRangeSnapshotsEqual(leftRange, rightRange) {
  if (!leftRange || !rightRange) return leftRange === rightRange
  const leftIsOffsets =
    typeof leftRange.start === 'number' && typeof leftRange.end === 'number'
  const rightIsOffsets =
    typeof rightRange.start === 'number' && typeof rightRange.end === 'number'
  if (leftIsOffsets || rightIsOffsets) {
    return (
      leftIsOffsets &&
      rightIsOffsets &&
      leftRange.start === rightRange.start &&
      leftRange.end === rightRange.end
    )
  }
  if (!(leftRange instanceof Range) || !(rightRange instanceof Range)) return false
  return (
    leftRange.startContainer === rightRange.startContainer &&
    leftRange.startOffset === rightRange.startOffset &&
    leftRange.endContainer === rightRange.endContainer &&
    leftRange.endOffset === rightRange.endOffset
  )
}

function doesSelectionSnapshotStillResolve(editableElement, expectedRange, expectedText) {
  if (!editableElement || !expectedRange) return false
  const resolvedText = String(expectedText || '')
  const start = typeof expectedRange.start === 'number' ? expectedRange.start : null
  const end = typeof expectedRange.end === 'number' ? expectedRange.end : null
  if (start == null || end == null || end <= start) return false
  const sourceText =
    editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT'
      ? String(editableElement.value || '')
      : String(editableElement.textContent || '')
  try {
    return sourceText.slice(start, end) === resolvedText
  } catch (error) {
    console.warn(error)
    return false
  }
}

function doesSelectionStillMatchSnapshot(editableElement, expectedRange, expectedText) {
  if (!editableElement || !expectedRange) return false
  const activeEditableElement = getActiveEditableElement()
  if (activeEditableElement && activeEditableElement !== editableElement) return false
  const currentRange = getSelectionRangeSnapshotForElement(editableElement)
  if (!currentRange) {
    return doesSelectionSnapshotStillResolve(
      editableElement,
      expectedRange,
      expectedText,
    )
  }
  if (!areSelectionRangeSnapshotsEqual(currentRange, expectedRange)) return false
  return getEditableSelectionTextForElement(editableElement) === String(expectedText || '')
}

function canSelectionDragCandidateStillStart(editableElement, expectedRange, expectedText) {
  if (!editableElement || !expectedRange) return false
  const activeEditableElement = getActiveEditableElement()
  if (activeEditableElement && activeEditableElement !== editableElement) return false
  return doesSelectionSnapshotStillResolve(editableElement, expectedRange, expectedText)
}

function getEditableTextSnapshot(editableElement) {
  if (!editableElement) return ''
  if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
    return String(editableElement.value || '')
  }
  return String(editableElement.textContent || '')
}

function getRuntimeMindMapDocumentFingerprint() {
  try {
    const mindMap = getMindMap()
    if (typeof mindMap?.getFullData === 'function') {
      return JSON.stringify(cloneValue(mindMap.getFullData()) || null)
    }
    if (typeof mindMap?.getData === 'function') {
      return JSON.stringify(cloneValue(mindMap.getData()) || null)
    }
  } catch (error) {
    console.warn(error)
  }

  return JSON.stringify(
    cloneValue(window.__memoryAnkiPendingEditorState?.editorState?.editor_doc) || null,
  )
}

function getRuntimeEditorDocSnapshot() {
  try {
    const mindMap = getMindMap()
    if (typeof mindMap?.getFullData === 'function') {
      return cloneValue(mindMap.getFullData()) || null
    }
    if (typeof mindMap?.getData === 'function') {
      return cloneValue(mindMap.getData()) || null
    }
  } catch (error) {
    console.warn(error)
  }

  return null
}

function getCurrentEditorDocSnapshot() {
  const runtimeDoc = getRuntimeEditorDocSnapshot()
  if (runtimeDoc) {
    return runtimeDoc
  }
  try {
    const bridgeData = getHostBridge()?.getMindMapData?.()
    if (typeof bridgeData !== 'undefined') {
      return cloneValue(bridgeData) || null
    }
  } catch (error) {
    console.warn(error)
  }

  return cloneValue(window.__memoryAnkiPendingEditorState?.editorState?.editor_doc) || null
}

function getPaperLayoutReflowFingerprint() {
  const fingerprint = getRuntimeMindMapDocumentFingerprint()
  return typeof fingerprint === 'string' ? fingerprint : ''
}

function markPaperLayoutReflowComplete() {
  const fingerprint = getPaperLayoutReflowFingerprint()
  if (
    paperLayoutReflowState.requestedFingerprint &&
    paperLayoutReflowState.requestedFingerprint === fingerprint
  ) {
    paperLayoutReflowState.completedFingerprint = fingerprint
  }
  paperLayoutReflowState.inFlight = false
  paperLayoutReflowState.requestedFingerprint = ''
}

function runPaperLayoutReflow() {
  const fingerprint = getPaperLayoutReflowFingerprint()
  paperLayoutReflowState.scheduled = false
  paperLayoutReflowState.queuedFingerprint = ''
  if (!fingerprint || paperLayoutReflowState.completedFingerprint === fingerprint) {
    paperLayoutReflowState.inFlight = false
    paperLayoutReflowState.requestedFingerprint = ''
    return false
  }
  paperLayoutReflowState.requestedFingerprint = fingerprint
  markPaperLayoutReflowComplete()
  return false
}

function requestPaperLayoutReflow() {
  return runPaperLayoutReflow()
}

function clearSelectionDragHoldTimer() {
  if (selectionDragState.holdTimer == null) return
  window.clearTimeout(selectionDragState.holdTimer)
  selectionDragState.holdTimer = null
}

function armSelectionDragHoldTimer() {
  clearSelectionDragHoldTimer()
  selectionDragState.holdReady = false
  selectionDragState.holdTimer = window.setTimeout(() => {
    selectionDragState.holdTimer = null
    if (selectionDragState.stage !== 'pending') return
    selectionDragState.holdReady = true
  }, SELECTION_DRAG_HOLD_DELAY)
}

function shouldSuppressSelectionDragContextMenu() {
  if (selectionDragState.stage === 'pending' || selectionDragState.stage === 'dragging') {
    return true
  }
  const until = Number(selectionDragState.contextMenuBlockUntil || 0)
  return until > Date.now()
}

function ownsSelectionDragPointer(event) {
  if (!selectionDragState.ownsPointerSequence) return false
  if (!event) return true
  if (
    selectionDragState.pointerId != null &&
    typeof event.pointerId === 'number' &&
    event.pointerId !== selectionDragState.pointerId
  ) {
    return false
  }
  return true
}

function tryCaptureSelectionDragPointer(event) {
  const target = event?.target
  if (!(target instanceof Element)) return false
  if (typeof target.setPointerCapture !== 'function') return false
  if (typeof event?.pointerId !== 'number') return false
  try {
    target.setPointerCapture(event.pointerId)
    selectionDragState.pointerCaptureElement = target
    return true
  } catch (error) {
    console.warn(error)
    return false
  }
}

function releaseSelectionDragPointerCapture() {
  const captureElement = selectionDragState.pointerCaptureElement
  const pointerId = selectionDragState.pointerId
  if (!(captureElement instanceof Element)) {
    selectionDragState.pointerCaptureElement = null
    return
  }
  if (typeof captureElement.releasePointerCapture !== 'function') {
    selectionDragState.pointerCaptureElement = null
    return
  }
  try {
    if (
      typeof pointerId === 'number' &&
      (typeof captureElement.hasPointerCapture !== 'function' ||
        captureElement.hasPointerCapture(pointerId))
    ) {
      captureElement.releasePointerCapture(pointerId)
    }
  } catch (error) {
    console.warn(error)
  }
  selectionDragState.pointerCaptureElement = null
}

function suppressSelectionDragNativePointerEvent(event, options = {}) {
  event?.preventDefault?.()
  event?.stopPropagation?.()
  event?.stopImmediatePropagation?.()
  if (options.capturePointer) {
    tryCaptureSelectionDragPointer(event)
  }
}

function captureSelectionDragFocusSnapshot() {
  return {
    committedNodeUid: focusState.committedNodeUid || null,
    visualFocusNodeUid: focusState.visualFocusNodeUid || null,
    editingNodeUid: focusState.editingNodeUid || null,
  }
}

function restoreSelectionDragFocusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false
  focusState.committedNodeUid = snapshot.committedNodeUid || null
  focusState.visualFocusNodeUid = snapshot.visualFocusNodeUid || snapshot.committedNodeUid || null
  focusState.editingNodeUid = snapshot.editingNodeUid || null
  syncKeyboardMode()
  restoreStableFocusAfterRender()
  updateKeyboardFocusClass()
  return true
}

function pushSelectionDragHistoryEntry(entry) {
  if (!entry) return
  selectionDragHistoryState.undoStack.push(entry)
  if (selectionDragHistoryState.undoStack.length > SELECTION_DRAG_HISTORY_LIMIT) {
    selectionDragHistoryState.undoStack.splice(
      0,
      selectionDragHistoryState.undoStack.length - SELECTION_DRAG_HISTORY_LIMIT,
    )
  }
  selectionDragHistoryState.redoStack = []
}

function beginSelectionDragHistoryEntry(selectedText) {
  const beforeDoc = getCurrentEditorDocSnapshot()
  if (!beforeDoc) {
    selectionDragHistoryState.pendingEntry = null
    return null
  }
  const pendingEntry = {
    id: selectionDragHistoryState.nextEntryId++,
    selectedText: String(selectedText || ''),
    beforeDoc,
    beforeFingerprint: JSON.stringify(beforeDoc),
    afterDoc: null,
    afterFingerprint: null,
    focusBefore: captureSelectionDragFocusSnapshot(),
    focusAfter: null,
    committed: false,
  }
  selectionDragHistoryState.pendingEntry = pendingEntry
  return pendingEntry
}

function finalizeSelectionDragHistoryEntry() {
  const pendingEntry = selectionDragHistoryState.pendingEntry
  if (!pendingEntry) return false
  const afterDoc = getCurrentEditorDocSnapshot()
  if (!afterDoc) return false
  const afterFingerprint = JSON.stringify(afterDoc)
  if (!afterFingerprint || afterFingerprint === pendingEntry.beforeFingerprint) {
    return false
  }
  pendingEntry.afterDoc = afterDoc
  pendingEntry.afterFingerprint = afterFingerprint
  pendingEntry.focusAfter = captureSelectionDragFocusSnapshot()
  pendingEntry.committed = true
  pushSelectionDragHistoryEntry(pendingEntry)
  selectionDragHistoryState.pendingEntry = null
  return true
}

function discardPendingSelectionDragHistoryEntry() {
  selectionDragHistoryState.pendingEntry = null
}

function applySelectionDragHistorySnapshot(entry, direction) {
  if (!entry || selectionDragHistoryState.applyingSnapshot) return false
  const snapshotDoc =
    direction === 'forward' ? cloneValue(entry.afterDoc) : cloneValue(entry.beforeDoc)
  const focusSnapshot =
    direction === 'forward' ? entry.focusAfter || entry.focusBefore : entry.focusBefore
  if (!snapshotDoc) return false
  const pendingEditorState = window.__memoryAnkiPendingEditorState?.editorState
  if (!pendingEditorState) return false
  selectionDragHistoryState.applyingSnapshot = true
  selectionDragHistoryState.pendingFocusSnapshot = focusSnapshot || null
  try {
    getHostBridge()?.saveMindMapData?.(cloneValue(snapshotDoc))
    syncHostEditorState({
      editorState: {
        ...cloneValue(pendingEditorState),
        editor_doc: snapshotDoc,
      },
      preserveView: true,
    })
    scheduleModeSync()
    return true
  } catch (error) {
    selectionDragHistoryState.pendingFocusSnapshot = null
    console.warn(error)
    return false
  } finally {
    window.setTimeout(() => {
      selectionDragHistoryState.applyingSnapshot = false
    }, 0)
  }
}

function tryConsumeSelectionDragHistory(direction) {
  if (direction !== 'back' && direction !== 'forward') return false
  const stack =
    direction === 'back'
      ? selectionDragHistoryState.undoStack
      : selectionDragHistoryState.redoStack
  if (!Array.isArray(stack) || stack.length === 0) return false
  const currentFingerprint = getRuntimeMindMapDocumentFingerprint()
  const candidate = stack[stack.length - 1]
  const expectedFingerprint =
    direction === 'back' ? candidate.afterFingerprint : candidate.beforeFingerprint
  if (!candidate || !expectedFingerprint || currentFingerprint !== expectedFingerprint) {
    return false
  }
  stack.pop()
  const oppositeStack =
    direction === 'back'
      ? selectionDragHistoryState.redoStack
      : selectionDragHistoryState.undoStack
  oppositeStack.push(candidate)
  return applySelectionDragHistorySnapshot(candidate, direction)
}

function pointInRect(rect, x, y) {
  if (!rect) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function isSelectionInsideEditable(editableElement) {
  if (!editableElement) return false
  if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
    const start =
      typeof editableElement.selectionStart === 'number' ? editableElement.selectionStart : 0
    const end =
      typeof editableElement.selectionEnd === 'number' ? editableElement.selectionEnd : start
    return end > start
  }
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0 || selection.isCollapsed) return false
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  const containsAnchor = anchorNode ? editableElement.contains(anchorNode) : false
  const containsFocus = focusNode ? editableElement.contains(focusNode) : false
  return containsAnchor || containsFocus
}

function getSelectionDragLayerElements() {
  const layer = document.querySelector('.memory-anki-selection-drag-layer')
  if (!layer) return null
  return {
    layer,
    line: layer.querySelector('.memory-anki-selection-drag-line'),
    slot: layer.querySelector('.memory-anki-selection-drag-slot'),
    proxy: layer.querySelector('.memory-anki-selection-drag-proxy'),
  }
}

function setSelectionDragInteractionActive(active) {
  document.body.classList.toggle('memory-anki-selection-dragging', Boolean(active))
}

function getNodeElement(nodeOrUid) {
  const node = typeof nodeOrUid === 'string' ? getNodeByUid(nodeOrUid) : nodeOrUid
  return node?.group?.node || null
}

function getNodeHoverElement(nodeOrUid) {
  const node = typeof nodeOrUid === 'string' ? getNodeByUid(nodeOrUid) : nodeOrUid
  return node?.hoverNode?.node || node?.group?.node?.querySelector?.('.smm-hover-node') || null
}

function clearSelectionDragNodeClasses() {
  getCachedNodes().forEach((node) => {
    const element = getNodeElement(node)
    element?.classList?.remove(
      'memory-anki-selection-drag-source',
      'memory-anki-selection-drag-target',
      'memory-anki-selection-drag-dimmed',
      'smm-node-highlight',
      'smm-node-dragging',
    )
  })
}

function clearSelectionDragLineDimming() {
  if (!Array.isArray(selectionDragState.dimmedLineNodes)) return
  selectionDragState.dimmedLineNodes.forEach((lineNode) => {
    lineNode?.classList?.remove?.('memory-anki-selection-drag-dimmed-line')
    if (lineNode?.style) {
      lineNode.style.removeProperty('opacity')
    }
  })
  selectionDragState.dimmedLineNodes = []
}

function getNodeLineElements(node) {
  if (!node || !Array.isArray(node._lines)) return []
  return node._lines
    .map((line) => line?.node || null)
    .filter(Boolean)
}

const PAPER_MAP_BRANCH_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#e11d48',
  '#0891b2',
  '#4f46e5',
  '#be123c',
]

const PAPER_MAP_NODE_CLASSES = [
  'memory-anki-paper-node',
  'memory-anki-paper-root',
  'memory-anki-paper-primary',
  'memory-anki-paper-branch',
  'memory-anki-paper-leaf',
  'memory-anki-paper-review-placeholder',
  'memory-anki-paper-review-revealed',
  'memory-anki-paper-review-red',
]

function getRuntimeNodeDepth(node) {
  let depth = 0
  let current = node
  while (current?.parent) {
    depth += 1
    current = current.parent
  }
  return depth
}

function getRuntimeBranchIndex(node) {
  let current = node
  let parent = current?.parent || null
  if (!parent) return 0
  while (parent?.parent) {
    current = parent
    parent = parent.parent
  }
  const siblings = Array.isArray(parent?.children) ? parent.children : []
  const index = siblings.indexOf(current)
  return index >= 0 ? index : 0
}

function getPaperBranchColor(node) {
  const branchIndex = getRuntimeBranchIndex(node)
  return PAPER_MAP_BRANCH_COLORS[branchIndex % PAPER_MAP_BRANCH_COLORS.length]
}

function normalizePaperColor(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hexToRgbParts(hex) {
  const value = normalizePaperColor(hex).replace('#', '')
  if (!/^[0-9a-f]{6}$/.test(value)) return null
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

function hexToRgba(hex, alpha) {
  const rgb = hexToRgbParts(hex)
  if (!rgb) return `rgba(24, 24, 27, ${alpha})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function tintHexColor(hex, amount) {
  const rgb = hexToRgbParts(hex)
  if (!rgb) return '#ffffff'
  const mix = Math.max(0, Math.min(1, Number(amount)))
  const toChannel = (value) => Math.round(value + (255 - value) * mix)
  const toHex = (value) => toChannel(value).toString(16).padStart(2, '0')
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

function getPaperReviewRole(data, isRoot) {
  if (isRoot) return 'root'
  const fillColor = normalizePaperColor(data?.fillColor)
  const borderColor = normalizePaperColor(data?.borderColor)
  const text = stripHtmlToText(data?.text || '').trim()
  if (
    text === '待回忆' ||
    data?.hideNote === true ||
    fillColor === '#fff8e7' ||
    borderColor === '#d7a84d' ||
    fillColor === '#fffbeb' ||
    borderColor === '#f59e0b' ||
    fillColor === '#fff7ed' ||
    borderColor === '#f59e0b'
  ) {
    return 'placeholder'
  }
  if (
    fillColor === '#fff3f3' ||
    borderColor === '#c77882' ||
    fillColor === '#fff1f2' ||
    borderColor === '#e11d48' ||
    fillColor === '#fef2f2' ||
    borderColor === '#ef4444'
  ) {
    return 'red'
  }
  if (
    fillColor === '#eef8ef' ||
    borderColor === '#86ad86' ||
    fillColor === '#ecfdf5' ||
    borderColor === '#10b981' ||
    borderColor === '#22c55e'
  ) {
    return 'revealed'
  }
  return 'default'
}

function buildPaperNodeStyle(node) {
  const data = getRuntimeNodeDataContainer(node) || {}
  const isRoot = !node?.parent || data.memoryAnkiRootKind === 'palace' || data.memoryAnkiRootKind === 'subject'
  const depth = getRuntimeNodeDepth(node)
  const branchColor = isRoot ? '#18181b' : getPaperBranchColor(node)
  const reviewRole = getPaperReviewRole(data, isRoot)
  if (reviewRole === 'root') {
    return {
      branchColor,
      fill: '#18181b',
      stroke: '#09090b',
      text: '#fafafa',
      shadow: 'rgba(24, 24, 27, 0.28)',
      fontWeight: '760',
      shapeStrokeWidth: '1.5',
      reviewRole,
    }
  }
  if (reviewRole === 'placeholder') {
    return {
      branchColor: '#d97706',
      fill: '#fffbeb',
      stroke: '#f59e0b',
      text: '#92400e',
      shadow: 'rgba(217, 119, 6, 0.18)',
      fontWeight: '650',
      shapeStrokeWidth: '1.6',
      reviewRole,
    }
  }
  if (reviewRole === 'revealed') {
    return {
      branchColor: '#059669',
      fill: '#ecfdf5',
      stroke: '#10b981',
      text: '#065f46',
      shadow: 'rgba(5, 150, 105, 0.16)',
      fontWeight: '650',
      shapeStrokeWidth: '1.6',
      reviewRole,
    }
  }
  if (reviewRole === 'red') {
    return {
      branchColor: '#e11d48',
      fill: '#fff1f2',
      stroke: '#e11d48',
      text: '#881337',
      shadow: 'rgba(225, 29, 72, 0.16)',
      fontWeight: '680',
      shapeStrokeWidth: '1.7',
      reviewRole,
    }
  }
  if (depth === 1) {
    return {
      branchColor,
      fill: branchColor,
      stroke: branchColor,
      text: '#ffffff',
      shadow: hexToRgba(branchColor, 0.24),
      fontWeight: '720',
      shapeStrokeWidth: '1.5',
      reviewRole,
    }
  }
  return {
    branchColor,
    fill: depth === 2 ? tintHexColor(branchColor, 0.93) : '#ffffff',
    stroke: depth === 2 ? tintHexColor(branchColor, 0.55) : '#e4e4e7',
    text: '#18181b',
    shadow: depth <= 2 ? hexToRgba(branchColor, 0.12) : 'rgba(24, 24, 27, 0.09)',
    fontWeight: depth === 2 ? '640' : '560',
    shapeStrokeWidth: depth === 2 ? '1.35' : '1.1',
    reviewRole,
  }
}

function applyPaperNodeTextStyle(node, style) {
  const element = getNodeElement(node)
  if (!element?.querySelectorAll) return
  element
    .querySelectorAll('.smm-text-node-wrap, .smm-richtext-node-wrap, .smm-desctext-node-wrap, .ql-editor')
    .forEach((textWrap) => {
      if (!textWrap?.style) return
      textWrap.style.setProperty('box-sizing', 'border-box')
      textWrap.style.setProperty('color', style.text)
      textWrap.style.setProperty('font-weight', style.fontWeight || '560')
      textWrap.style.setProperty('line-height', '1.2')
      textWrap.style.setProperty('max-width', '100%')
      textWrap.style.setProperty('min-width', '0')
      textWrap.style.setProperty('overflow', 'visible', 'important')
      textWrap.style.setProperty('overflow-wrap', 'break-word')
      textWrap.style.setProperty('white-space', 'normal')
      textWrap.style.setProperty('width', '100%')
      textWrap.style.setProperty('word-break', 'normal')
    })
  element
    .querySelectorAll('.smm-richtext-node-wrap *, .smm-desctext-node-wrap *, .ql-editor *')
    .forEach((child) => {
      if (!child?.style) return
      child.style.setProperty('box-sizing', 'border-box')
      child.style.setProperty('color', 'inherit')
      child.style.setProperty('max-width', '100%')
      child.style.setProperty('min-width', '0')
      child.style.setProperty('overflow-wrap', 'break-word')
      child.style.setProperty('width', '100%')
      child.style.setProperty('word-break', 'normal')
      if (child.tagName === 'P') {
        child.style.setProperty('box-sizing', 'border-box')
        child.style.setProperty('margin', '0')
        child.style.setProperty('max-width', '100%')
        child.style.setProperty('min-width', '0')
        child.style.setProperty('width', '100%')
      }
    })
}

function applyPaperNodeStyle(node) {
  const element = getNodeElement(node)
  if (!element?.classList || !element.style) return
  const isRoot = !node?.parent
  const depth = getRuntimeNodeDepth(node)
  const isLeaf = !Array.isArray(node?.children) || node.children.length === 0
  const style = buildPaperNodeStyle(node)
  const shape = element.querySelector?.('.smm-node-shape')
  element.classList.remove(...PAPER_MAP_NODE_CLASSES)
  element.classList.add('memory-anki-paper-node')
  element.classList.add(
    isRoot
      ? 'memory-anki-paper-root'
      : depth === 1 && style.reviewRole === 'default'
        ? 'memory-anki-paper-primary'
        : isLeaf
          ? 'memory-anki-paper-leaf'
          : 'memory-anki-paper-branch',
  )
  if (style.reviewRole === 'placeholder') element.classList.add('memory-anki-paper-review-placeholder')
  if (style.reviewRole === 'revealed') element.classList.add('memory-anki-paper-review-revealed')
  if (style.reviewRole === 'red') element.classList.add('memory-anki-paper-review-red')
  element.style.setProperty('--memory-anki-paper-branch-color', style.branchColor)
  element.style.setProperty('--memory-anki-paper-node-fill', style.fill)
  element.style.setProperty('--memory-anki-paper-node-stroke', style.stroke)
  element.style.setProperty('--memory-anki-paper-node-text', style.text)
  element.style.setProperty('--memory-anki-paper-node-shadow', style.shadow)
  element.style.setProperty('--memory-anki-paper-node-weight', style.fontWeight || '560')
  if (shape?.style) {
    shape.style.fill = style.fill
    shape.style.stroke = style.stroke
    shape.style.strokeWidth = style.shapeStrokeWidth || (isRoot ? '1.5' : '1.25')
    shape.style.filter = isRoot
      ? 'drop-shadow(0 1px 0 rgba(255, 255, 255, 0.1)) drop-shadow(0 18px 34px rgba(24, 24, 27, 0.28))'
      : `drop-shadow(0 1px 0 rgba(255, 255, 255, 0.82)) drop-shadow(0 12px 22px ${style.shadow})`
    shape.setAttribute?.('rx', depth <= 1 ? '10' : '8')
    shape.setAttribute?.('ry', depth <= 1 ? '10' : '8')
  }
  applyPaperNodeTextStyle(node, style)
}

function applyPaperLineStyle(node) {
  if (!node?.parent) return
  const style = buildPaperNodeStyle(node)
  const data = getRuntimeNodeDataContainer(node) || {}
  const completedLine =
    normalizePaperColor(data.lineColor) === '#10b981' ||
    normalizePaperColor(data.lineColor) === '#86ad86' ||
    normalizePaperColor(data.lineColor) === '#22c55e'
  const lineColor = completedLine ? '#10b981' : style.branchColor
  getNodeLineElements(node).forEach((lineNode) => {
    if (!lineNode?.classList || !lineNode.style) return
    lineNode.classList.add('memory-anki-paper-line')
    lineNode.classList.toggle('memory-anki-paper-review-complete-line', completedLine)
    lineNode.style.setProperty('--memory-anki-paper-line-color', lineColor)
    lineNode.style.stroke = lineColor
    lineNode.style.strokeWidth = completedLine ? '3' : getRuntimeNodeDepth(node) === 1 ? '2.9' : '2.45'
    lineNode.style.strokeLinecap = 'round'
    lineNode.style.strokeLinejoin = 'round'
    lineNode.style.opacity = completedLine ? '0.88' : '0.72'
    lineNode.style.filter = 'drop-shadow(0 1px 0 rgba(255, 255, 255, 0.75))'
  })
}

function applyUnifiedMindMapAppearance() {
  document.body.classList.add('memory-anki-paper-map')
  getCachedNodes().forEach((node) => {
    applyPaperNodeStyle(node)
    applyPaperLineStyle(node)
  })
}

function clearReviewFxState() {
  reviewFxState.activeTimers.forEach((timer) => {
    window.clearTimeout(timer)
  })
  reviewFxState.activeTimers.clear()
  reviewFxState.activeNodeClasses.forEach((classNames, uid) => {
    const element = getNodeElement(uid)
    if (element?.classList && Array.isArray(classNames)) {
      element.classList.remove(...classNames)
    }
  })
  reviewFxState.activeLineClasses.forEach((classNames, key) => {
    const [uid, indexValue] = String(key).split(':')
    const node = getNodeByUid(uid)
    const line = getNodeLineElements(node)[Number(indexValue)] || null
    if (line?.classList && Array.isArray(classNames)) {
      line.classList.remove(...classNames)
    }
  })
  reviewFxState.activeNodeClasses.clear()
  reviewFxState.activeLineClasses.clear()
}

function isReviewFxAllowed(intensity) {
  const hostState = window.__memoryAnkiHostState || {}
  if (!hostState.readonly || !hostState.practiceModeActive) return false
  return intensity !== 'none'
}

function isReadonlyPracticeMode() {
  const hostState = window.__memoryAnkiHostState || {}
  return Boolean(hostState.readonly && hostState.practiceModeActive)
}

function registerReviewFxCleanup(timer) {
  reviewFxState.activeTimers.add(timer)
}

function markNodeReviewFx(uid, classNames, durationMs) {
  const element = getNodeElement(uid)
  if (!element?.classList || !Array.isArray(classNames) || classNames.length === 0) return
  const previous = reviewFxState.activeNodeClasses.get(uid) || []
  if (previous.length > 0) {
    element.classList.remove(...previous)
  }
  element.classList.add(...classNames)
  reviewFxState.activeNodeClasses.set(uid, classNames)
  const timer = window.setTimeout(() => {
    reviewFxState.activeTimers.delete(timer)
    element.classList.remove(...classNames)
    if (reviewFxState.activeNodeClasses.get(uid) === classNames) {
      reviewFxState.activeNodeClasses.delete(uid)
    }
  }, durationMs)
  registerReviewFxCleanup(timer)
}

function markLineReviewFx(uid, lineClassName, durationMs, options = {}) {
  const node = getNodeByUid(uid)
  const lines = getNodeLineElements(node)
  lines.forEach((line, index) => {
    if (!line?.classList) return
    const classNames = [lineClassName]
    if (options.soft) classNames.push('memory-anki-review-line-soft')
    const key = `${uid}:${index}`
    const previous = reviewFxState.activeLineClasses.get(key) || []
    if (previous.length > 0) {
      line.classList.remove(...previous)
    }
    line.classList.add(...classNames)
    reviewFxState.activeLineClasses.set(key, classNames)
    const timer = window.setTimeout(() => {
      reviewFxState.activeTimers.delete(timer)
      line.classList.remove(...classNames)
      if (reviewFxState.activeLineClasses.get(key) === classNames) {
        reviewFxState.activeLineClasses.delete(key)
      }
    }, durationMs)
    registerReviewFxCleanup(timer)
  })
}

function collectReviewFxPath(uid, depthLimit = 3) {
  const path = []
  let current = getNodeByUid(uid)
  let steps = 0
  while (current && steps < depthLimit) {
    const currentUid = getNodeUid(current)
    if (!currentUid) break
    path.push(currentUid)
    current = current.parent || null
    steps += 1
  }
  return path
}

function buildReviewFxNodeClasses(baseClassName, soft, extraClassNames = []) {
  return [baseClassName].concat(extraClassNames).concat(soft ? ['memory-anki-review-soft'] : [])
}

function isFeedbackFxAllowed(intensity) {
  return intensity !== 'none'
}

function getFeedbackLevel(type) {
  if (
    type === 'key_press' ||
    type === 'pointer_down' ||
    type === 'pointer_click' ||
    type === 'hover_pulse' ||
    type === 'node_select' ||
    type === 'drag_start' ||
    type === 'node_move' ||
    type === 'toolbar_action'
  ) return 'micro'
  if (
    type === 'branch_clear' ||
    type === 'all_clear_ready' ||
    type === 'session_complete' ||
    type === 'import_apply'
  ) return 'milestone'
  return 'action'
}

function getFeedbackOrigin(type, source) {
  if (source === 'keydown' || type === 'key_press' || type === 'text_commit') return 'keyboard'
  if (source === 'clickable' || source === 'fullscreen' || type === 'toolbar_action' || type === 'mode_switch') return 'toolbar'
  if (type === 'category_expand' || type === 'next_level_expand' || type === 'card_reveal' || type === 'branch_clear' || type === 'all_clear_ready' || type === 'session_complete') return 'review'
  if (type === 'pointer_down' || type === 'pointer_click' || type === 'context_menu' || type === 'drag_start' || type === 'drag_drop') return 'pointer'
  if (type === 'save_success' || type === 'save_error' || type === 'import_apply') return 'system'
  return 'node'
}

function getFeedbackVisualKind(type) {
  if (type === 'node_delete' || type === 'save_error') return 'danger'
  if (type === 'node_create' || type === 'import_apply') return 'create'
  if (type === 'card_reveal' || type === 'branch_clear' || type === 'all_clear_ready' || type === 'session_complete') return 'reward'
  if (type === 'bilink_action') return 'link'
  if (type === 'segment_action') return 'segment'
  if (type === 'drag_start' || type === 'drag_drop' || type === 'node_move') return 'move'
  if (type === 'mode_switch' || type === 'toolbar_action') return 'mode'
  if (type === 'node_edit_start' || type === 'key_press' || type === 'text_commit' || type === 'save_success') return 'edit'
  if (type === 'pointer_down') return 'touch'
  return 'select'
}

function getFeedbackParticleColor(kind) {
  if (kind === 'danger') return 'rgba(239, 68, 68, 0.95)'
  if (kind === 'create' || kind === 'reward') return 'rgba(251, 191, 36, 0.95)'
  if (kind === 'link') return 'rgba(168, 85, 247, 0.9)'
  if (kind === 'segment') return 'rgba(245, 158, 11, 0.9)'
  if (kind === 'move') return 'rgba(99, 102, 241, 0.92)'
  if (kind === 'mode') return 'rgba(245, 158, 11, 0.92)'
  if (kind === 'edit') return 'rgba(14, 165, 233, 0.92)'
  return 'rgba(59, 130, 246, 0.9)'
}

function getFeedbackNodeClassName(type) {
  return `memory-anki-feedback-${getFeedbackVisualKind(type)}`
}

function getFeedbackLineClassName(type) {
  if (type === 'node_delete' || type === 'save_error') return 'memory-anki-review-line-clear'
  const kind = getFeedbackVisualKind(type)
  if (kind === 'create' || kind === 'reward') return 'memory-anki-feedback-line-create'
  if (kind === 'link') return 'memory-anki-feedback-line-link'
  if (kind === 'segment') return 'memory-anki-feedback-line-segment'
  if (kind === 'move') return 'memory-anki-feedback-line-move'
  if (type === 'text_commit' || type === 'save_success') {
    return 'memory-anki-review-line-confirm'
  }
  if (type === 'node_edit_start' || type === 'key_press') return 'memory-anki-review-line-spawn'
  return 'memory-anki-review-line-trace'
}

function createFeedbackRipple(x, y, type = 'pointer_click', level = getFeedbackLevel(type)) {
  if (typeof x !== 'number' || typeof y !== 'number') return
  const layer = document.querySelector('.memory-anki-feedback-ripple-layer')
  if (!layer) return
  const kind = getFeedbackVisualKind(type)
  const ripple = document.createElement('span')
  ripple.className = `memory-anki-feedback-ripple is-feedback-${kind} is-feedback-level-${level}`
  ripple.style.left = `${Math.round(x)}px`
  ripple.style.top = `${Math.round(y)}px`
  layer.appendChild(ripple)
  if (level !== 'micro' && (kind === 'create' || kind === 'reward' || kind === 'link' || kind === 'segment' || kind === 'danger')) {
    createFeedbackParticles(x, y, type, kind, level)
  }
  window.setTimeout(() => {
    ripple.remove()
  }, level === 'milestone' ? 520 : level === 'action' ? 380 : 260)
}

function createFeedbackParticles(x, y, type, kind = getFeedbackVisualKind(type), level = getFeedbackLevel(type)) {
  const layer = document.querySelector('.memory-anki-feedback-ripple-layer')
  if (!layer) return
  if (level === 'micro') return
  const count =
    level === 'milestone'
      ? 4
      : kind === 'create'
        ? 3
        : kind === 'danger'
          ? 2
          : 2
  const color = getFeedbackParticleColor(kind)
  for (let index = 0; index < count; index += 1) {
    const particle = document.createElement('span')
    particle.className = 'memory-anki-feedback-particle'
    particle.style.left = `${Math.round(x)}px`
    particle.style.top = `${Math.round(y)}px`
    particle.style.setProperty('--memory-anki-feedback-particle-color', color)
    const angle = (Math.PI * 2 * index) / count + (kind === 'danger' ? Math.PI / 8 : 0)
    const distance = level === 'milestone' ? 26 + (index % 2) * 6 : kind === 'danger' ? 16 + index * 2 : 20 + (index % 2) * 4
    particle.style.setProperty('--memory-anki-feedback-particle-x', `${Math.round(Math.cos(angle) * distance)}px`)
    particle.style.setProperty('--memory-anki-feedback-particle-y', `${Math.round(Math.sin(angle) * distance)}px`)
    layer.appendChild(particle)
    window.setTimeout(() => {
      particle.remove()
    }, 460)
  }
}

function scheduleFeedbackLayerRemoval(node, durationMs) {
  if (!node) return
  const timer = window.setTimeout(() => {
    node.remove()
  }, durationMs)
  registerReviewFxCleanup(timer)
}

function createReviewBurst(x, y, options = {}) {
  if (typeof x !== 'number' || typeof y !== 'number') return
  const layer = document.querySelector('.memory-anki-feedback-ripple-layer')
  if (!layer) return
  const burstKind = options.kind === 'critical' ? 'critical' : 'reveal'
  const soft = Boolean(options.soft)
  const milestoneStep = Number.isFinite(options.milestoneStep) ? Number(options.milestoneStep) : -1
  const shardCount = soft
    ? 4
    : burstKind === 'critical'
      ? 12
      : milestoneStep >= 0
        ? 9 + Math.min(milestoneStep, 4)
        : 7
  const shardDistanceBase = burstKind === 'critical' ? 48 : milestoneStep >= 0 ? 40 : 30

  const flash = document.createElement('span')
  flash.className = 'memory-anki-feedback-flash'
  flash.style.left = `${Math.round(x)}px`
  flash.style.top = `${Math.round(y)}px`
  layer.appendChild(flash)
  scheduleFeedbackLayerRemoval(flash, soft ? 180 : 260)

  const shockwave = document.createElement('span')
  shockwave.className = `memory-anki-feedback-shockwave${burstKind === 'critical' ? ' is-critical' : ''}`
  shockwave.style.left = `${Math.round(x)}px`
  shockwave.style.top = `${Math.round(y)}px`
  layer.appendChild(shockwave)
  scheduleFeedbackLayerRemoval(shockwave, soft ? 260 : burstKind === 'critical' ? 560 : 480)

  for (let index = 0; index < shardCount; index += 1) {
    const shard = document.createElement('span')
    shard.className = `memory-anki-feedback-shard${soft ? ' is-soft' : ''}`
    shard.style.left = `${Math.round(x)}px`
    shard.style.top = `${Math.round(y)}px`
    const angle = (Math.PI * 2 * index) / shardCount + (burstKind === 'critical' ? Math.PI / 14 : Math.PI / 10)
    const distance = shardDistanceBase + (index % 3) * (soft ? 4 : 8)
    shard.style.setProperty('--memory-anki-feedback-shard-x', `${Math.round(Math.cos(angle) * distance)}px`)
    shard.style.setProperty('--memory-anki-feedback-shard-y', `${Math.round(Math.sin(angle) * distance)}px`)
    shard.style.setProperty('--memory-anki-feedback-shard-rotate', `${Math.round((angle * 180) / Math.PI)}deg`)
    layer.appendChild(shard)
    scheduleFeedbackLayerRemoval(shard, soft ? 300 : 440)
  }

  if (!soft) {
    createFeedbackParticles(
      x,
      y,
      burstKind === 'critical' ? 'branch_clear' : 'card_reveal',
      burstKind === 'critical' ? 'reward' : 'create',
      milestoneStep >= 0 || burstKind === 'critical' ? 'milestone' : 'action',
    )
  }
}

function emitHostFeedback(type, options = {}) {
  if (!type) return
  const now = Date.now()
  const throttleKey = options.throttleKey || type
  const throttleMs = typeof options.throttleMs === 'number' ? options.throttleMs : 0
  if (throttleMs > 0) {
    const lastAt = feedbackState.lastEventAtByKey.get(throttleKey) || 0
    if (now - lastAt < throttleMs) return
    feedbackState.lastEventAtByKey.set(throttleKey, now)
  }
  getHostBridge()?.notify?.('feedback_event', {
    type,
    source: options.source || null,
    level: options.level || getFeedbackLevel(type),
    origin: options.origin || getFeedbackOrigin(type, options.source),
    nodeUid: options.nodeUid || null,
    x: typeof options.x === 'number' ? options.x : null,
    y: typeof options.y === 'number' ? options.y : null,
  })
}

function emitFeedbackFx(payload) {
  const type = payload && typeof payload.type === 'string' ? payload.type : ''
  const intensity = payload && typeof payload.intensity === 'string' ? payload.intensity : 'full'
  if (!isFeedbackFxAllowed(intensity)) return
  const soft = intensity === 'soft'
  const level = payload && typeof payload.level === 'string' ? payload.level : getFeedbackLevel(type)
  const nodeUid = payload && typeof payload.nodeUid === 'string' ? payload.nodeUid : null
  const relatedNodeUids = Array.isArray(payload?.relatedNodeUids)
    ? payload.relatedNodeUids.filter((value) => typeof value === 'string')
    : []
  if (typeof payload?.x === 'number' && typeof payload?.y === 'number') {
    createFeedbackRipple(payload.x, payload.y, type, level)
  }
  const visualKind = getFeedbackVisualKind(type)
  const targetUids = nodeUid
    ? [nodeUid]
    : relatedNodeUids.length > 0
      ? relatedNodeUids.slice(-4)
      : []
  if (
    !(typeof payload?.x === 'number' && typeof payload?.y === 'number') &&
    targetUids.length > 0 &&
    (visualKind === 'create' || visualKind === 'reward' || visualKind === 'danger')
  ) {
    const rect = getNodeElement(targetUids[0])?.getBoundingClientRect?.()
    if (rect) {
      createFeedbackRipple(rect.left + rect.width / 2, rect.top + rect.height / 2, type, level)
    }
  }
  targetUids.forEach((uid, index) => {
    const timer = window.setTimeout(() => {
      reviewFxState.activeTimers.delete(timer)
      markNodeReviewFx(
        uid,
        buildReviewFxNodeClasses(getFeedbackNodeClassName(type), soft),
        level === 'micro' ? 180 : level === 'milestone' ? 520 : 360,
      )
      markLineReviewFx(uid, getFeedbackLineClassName(type), level === 'micro' ? 180 : 360, { soft })
    }, index * 40)
    registerReviewFxCleanup(timer)
  })
}

function emitReviewFx(payload) {
  const type = payload && typeof payload.type === 'string' ? payload.type : ''
  const intensity = payload && typeof payload.intensity === 'string' ? payload.intensity : 'none'
  const lineMode = payload && typeof payload.lineMode === 'string' ? payload.lineMode : 'trace'
  if (!isReviewFxAllowed(intensity)) {
    clearReviewFxState()
    document.body.classList.remove('memory-anki-review-fx-enabled')
    return
  }

  document.body.classList.add('memory-anki-review-fx-enabled')
  const soft = intensity === 'soft'
  const nodeUid = payload && typeof payload.nodeUid === 'string' ? payload.nodeUid : null
  const relatedNodeUids = Array.isArray(payload?.relatedNodeUids)
    ? payload.relatedNodeUids.filter((value) => typeof value === 'string')
    : []

  if (type === 'session_reset') {
    clearReviewFxState()
    return
  }

  if ((type === 'category_expand' || type === 'next_level_expand') && nodeUid) {
    const rect = getNodeElement(nodeUid)?.getBoundingClientRect?.()
    if (rect) {
      createFeedbackRipple(rect.left + rect.width / 2, rect.top + rect.height / 2, 'node_create')
    }
    markNodeReviewFx(
      nodeUid,
      buildReviewFxNodeClasses('memory-anki-review-expand-hit', soft, ['memory-anki-review-ring-strong']),
      520,
    )
    const path = collectReviewFxPath(nodeUid, type === 'category_expand' ? 2 : 3)
    path.forEach((uid, index) => {
      const timer = window.setTimeout(() => {
        reviewFxState.activeTimers.delete(timer)
        markLineReviewFx(uid, lineMode === 'spawn' ? 'memory-anki-review-line-spawn' : 'memory-anki-review-line-trace', 540, { soft })
      }, index * 70)
      registerReviewFxCleanup(timer)
    })
    return
  }

  if (type === 'card_reveal' && nodeUid) {
    const rect = getNodeElement(nodeUid)?.getBoundingClientRect?.()
    if (rect) {
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      createFeedbackRipple(centerX, centerY, 'card_reveal', payload?.milestoneStep != null ? 'milestone' : 'action')
      createReviewBurst(centerX, centerY, {
        soft,
        milestoneStep: payload?.milestoneStep,
      })
    }
    markNodeReviewFx(
      nodeUid,
      buildReviewFxNodeClasses('memory-anki-review-reveal-hit', soft, ['memory-anki-review-ring-strong']),
      payload?.milestoneStep != null && !soft ? 680 : 560,
    )
    const path = collectReviewFxPath(nodeUid, 3)
    path.forEach((uid, index) => {
      const timer = window.setTimeout(() => {
        reviewFxState.activeTimers.delete(timer)
        markLineReviewFx(uid, lineMode === 'confirm' ? 'memory-anki-review-line-confirm' : 'memory-anki-review-line-trace', 440, { soft })
      }, index * 55)
      registerReviewFxCleanup(timer)
    })
    return
  }

  if (type === 'branch_clear' && nodeUid) {
    const rect = getNodeElement(nodeUid)?.getBoundingClientRect?.()
    if (rect) {
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      createFeedbackRipple(centerX, centerY, 'branch_clear', 'milestone')
      createReviewBurst(centerX, centerY, {
        soft,
        kind: 'critical',
      })
    }
    const path = collectReviewFxPath(nodeUid, 3)
    path.forEach((uid, index) => {
      const timer = window.setTimeout(() => {
        reviewFxState.activeTimers.delete(timer)
        markNodeReviewFx(
          uid,
          buildReviewFxNodeClasses(
            index === 0 ? 'memory-anki-review-branch-clear' : 'memory-anki-review-pulse-source',
            soft,
          ),
          520,
        )
        markLineReviewFx(
          uid,
          index === 0 || lineMode === 'clear' ? 'memory-anki-review-line-clear' : 'memory-anki-review-line-trace',
          500,
          { soft },
        )
      }, index * 90)
      registerReviewFxCleanup(timer)
    })
    return
  }

  if (type === 'all_clear_ready' || type === 'session_complete') {
    const targetUids = relatedNodeUids.length > 0 ? relatedNodeUids.slice(-6) : []
    const firstRect = getNodeElement(targetUids.at(-1))?.getBoundingClientRect?.()
    if (firstRect) {
      createFeedbackRipple(firstRect.left + firstRect.width / 2, firstRect.top + firstRect.height / 2, type)
    }
    targetUids.forEach((uid, index) => {
      const timer = window.setTimeout(() => {
        reviewFxState.activeTimers.delete(timer)
        markNodeReviewFx(
          uid,
          [
            'memory-anki-review-pulse-source',
            'memory-anki-review-ring-strong',
          ].concat(soft ? ['memory-anki-review-soft'] : []),
          type === 'session_complete' ? 620 : 440,
        )
        markLineReviewFx(
          uid,
          type === 'session_complete' ? 'memory-anki-review-line-clear' : 'memory-anki-review-line-trace',
          type === 'session_complete' ? 560 : 420,
          { soft },
        )
      }, index * 60)
      registerReviewFxCleanup(timer)
    })
  }
}

function collectBranchNodeUids(rootUid) {
  const visited = new Set()
  const walk = (uid) => {
    if (!uid || visited.has(uid)) return
    visited.add(uid)
    const node = getNodeByUid(uid)
    const children = Array.isArray(node?.children) ? node.children : []
    children.forEach((child) => walk(getNodeUid(child)))
  }
  walk(rootUid)
  return visited
}

function updateSelectionDragDimmedBranch(targetRootUid) {
  clearSelectionDragLineDimming()
  const keepUids = new Set()
  const sourceUid = selectionDragState.sourceNodeUid
  const sourceParentUid = selectionDragState.sourceParentUid
  const targetUid = selectionDragState.previewTargetNodeUid
  const targetRootNode =
    getNodeByUid(targetRootUid) ||
    getNodeByUid(targetUid) ||
    getNodeByUid(sourceUid) ||
    getNodeByUid(sourceParentUid)
  if (sourceParentUid) {
    collectBranchNodeUids(sourceParentUid).forEach((uid) => keepUids.add(uid))
  }
  if (targetRootNode) {
    collectBranchNodeUids(getNodeUid(targetRootNode)).forEach((uid) => keepUids.add(uid))
    let current = targetRootNode
    while (current) {
      const uid = getNodeUid(current)
      if (uid) keepUids.add(uid)
      current = current.parent || null
    }
  }
  if (sourceUid) keepUids.add(sourceUid)
  if (targetUid) keepUids.add(targetUid)

  const nextDimmedNodeUids = []
  const nextDimmedLineNodes = []
  getCachedNodes().forEach((node) => {
    const uid = getNodeUid(node)
    const element = getNodeElement(node)
    if (!uid || !element?.classList) return
    const shouldDim =
      selectionDragState.stage === 'dragging' &&
      selectionDragState.previewTargetMode !== 'cancel' &&
      !keepUids.has(uid)
    element.classList.toggle('memory-anki-selection-drag-dimmed', shouldDim)
    if (shouldDim) {
      nextDimmedNodeUids.push(uid)
      getNodeLineElements(node).forEach((lineNode) => {
        lineNode.classList?.add?.('memory-anki-selection-drag-dimmed-line')
        nextDimmedLineNodes.push(lineNode)
      })
    }
  })
  selectionDragState.dimmedNodeUids = nextDimmedNodeUids
  selectionDragState.dimmedLineNodes = nextDimmedLineNodes
}

function getSelectionDragProxyStyle(sourceNode) {
  const element = getNodeElement(sourceNode)
  const shapeNode = sourceNode?.shapeNode?.node || element?.querySelector?.('.smm-node-shape')
  const textWrap =
    element?.querySelector?.('.smm-richtext-node-wrap, .smm-text-node-wrap, .ql-editor') || element
  const shapeStyle = shapeNode ? window.getComputedStyle(shapeNode) : null
  const textStyle = textWrap ? window.getComputedStyle(textWrap) : null
  const resolvedFill =
    shapeNode?.getAttribute?.('fill') ||
    shapeStyle?.fill ||
    shapeStyle?.backgroundColor ||
    shapeStyle?.background ||
    ''
  const resolvedStroke =
    shapeNode?.getAttribute?.('stroke') ||
    shapeStyle?.stroke ||
    shapeStyle?.borderColor ||
    ''
  const isTransparent = (value) =>
    !value ||
    value === 'none' ||
    value === 'transparent' ||
    value === 'rgba(0, 0, 0, 0)' ||
    value === 'rgb(0, 0, 0, 0)'
  return {
    borderRadius: shapeStyle?.borderRadius || '12px',
    background: isTransparent(resolvedFill) ? 'rgba(255, 255, 255, 0.96)' : resolvedFill,
    borderColor: isTransparent(resolvedStroke) ? 'rgba(94, 200, 248, 0.72)' : resolvedStroke,
    color: textStyle?.color || '#0f172a',
    fontSize: textStyle?.fontSize || '14px',
    fontWeight: textStyle?.fontWeight || '600',
    fontFamily: textStyle?.fontFamily || 'inherit',
    lineHeight: textStyle?.lineHeight || '1.4',
    minHeight: `${Math.max(48, Math.round(selectionDragState.sourceNodeRect?.height || 48))}px`,
    width: `${Math.max(132, Math.min(240, Math.round(selectionDragState.sourceNodeRect?.width || 156)))}px`,
  }
}

function applySelectionDragProxy(intent) {
  const elements = getSelectionDragLayerElements()
  const proxy = elements?.proxy
  if (!proxy) return
  const sourceNode = resolveSelectionDragSourceNode()
  if (!sourceNode || selectionDragState.stage !== 'dragging') {
    proxy.hidden = true
    return
  }
  const metrics = getPlaceholderMetrics(selectionDragState.sourceText, selectionDragState.sourceNodeRect)
  const pointerOffsetX = 26
  const pointerOffsetY = 18
  const left = selectionDragState.currentX + pointerOffsetX
  const top = selectionDragState.currentY + pointerOffsetY
  selectionDragState.previewProxyRect = makeRect(left, top, metrics.width, metrics.height)
  const style = getSelectionDragProxyStyle(sourceNode)
  proxy.hidden = false
  proxy.style.left = `${left}px`
  proxy.style.top = `${top}px`
  proxy.style.width = style.width
  proxy.style.minHeight = style.minHeight
  proxy.style.borderRadius = style.borderRadius
  proxy.style.background = style.background
  proxy.style.borderColor = style.borderColor
  proxy.style.color = style.color
  proxy.style.fontSize = style.fontSize
  proxy.style.fontWeight = style.fontWeight
  proxy.style.fontFamily = style.fontFamily
  proxy.style.lineHeight = style.lineHeight
  proxy.style.opacity = intent?.mode === 'cancel' ? '0.88' : '1'
  proxy.style.transform = intent?.mode === 'cancel' ? 'translate3d(0, 0, 0) scale(0.98)' : 'translate3d(0, 0, 0) scale(1)'
  proxy.textContent = selectionDragState.sourceText
}

function clearSelectionDragLine() {
  const elements = getSelectionDragLayerElements()
  if (!elements?.line) return
  elements.line.setAttribute('d', '')
}

function getNodeOutgoingAnchor(node, mode) {
  const rect = getNodeRect(node)
  if (!rect) return null
  if (mode === 'child') {
    return {
      x: rect.right,
      y: rect.top + rect.height / 2,
    }
  }
  return {
    x: rect.left,
    y: rect.top + rect.height / 2,
  }
}

function getIntentPreviewPoint(intent) {
  if (!intent || intent.mode === 'cancel') return null
  if (intent.slotRect) {
    return {
      x: intent.slotRect.left,
      y: intent.slotRect.top + intent.slotRect.height / 2,
    }
  }
  if (intent.previewAnchor) {
    return intent.previewAnchor
  }
  return null
}

function renderSelectionDragConnection(intent) {
  clearSelectionDragLine()
}

function applySelectionDragSlot(intent) {
  const elements = getSelectionDragLayerElements()
  const slot = elements?.slot
  if (!slot) return
  if (!intent?.slotRect || intent.mode === 'cancel') {
    slot.hidden = true
    selectionDragState.previewInsertionBarRect = null
    return
  }
  slot.hidden = false
  slot.style.left = `${intent.slotRect.left}px`
  slot.style.top = `${intent.slotRect.top}px`
  slot.style.width = `${intent.slotRect.width}px`
  selectionDragState.previewInsertionBarRect = cloneValue(intent.slotRect)
}

function applyNativeLikeDropPreview(intent) {
  clearSelectionDragNodeClasses()
  const sourceNode = resolveSelectionDragSourceNode()
  const sourceElement = getNodeElement(sourceNode)
  sourceElement?.classList?.add('memory-anki-selection-drag-source', 'smm-node-dragging')

  selectionDragState.previewTargetNodeUid =
    intent?.highlightUid || intent?.anchorUid || null
  selectionDragState.previewTargetMode = intent?.mode || 'cancel'
  if (!intent || intent.mode === 'cancel') {
    applySelectionDragSlot(null)
    clearSelectionDragLine()
    updateSelectionDragDimmedBranch(null)
    return
  }

  const targetNode = getNodeByUid(intent.highlightUid || intent.anchorUid)
  const targetElement = getNodeElement(targetNode)
  targetElement?.classList?.add('memory-anki-selection-drag-target', 'smm-node-highlight')
  applySelectionDragSlot(intent)
  clearSelectionDragLine()
  const dimRootUid =
    intent.mode === 'child'
      ? intent.parentUid || selectionDragState.sourceParentUid
      : intent.parentUid || selectionDragState.sourceParentUid
  updateSelectionDragDimmedBranch(dimRootUid)
}

function restoreSelectionDragSourceSelection() {
  const sourceElement = resolveSelectionDragSourceElement()
  const sourceRange = selectionDragState.sourceRange
  if (!sourceElement || !sourceRange) return false
  const start = typeof sourceRange.start === 'number' ? sourceRange.start : null
  const end = typeof sourceRange.end === 'number' ? sourceRange.end : null
  if (sourceElement.tagName === 'TEXTAREA' || sourceElement.tagName === 'INPUT') {
    if (start == null || end == null) return false
    sourceElement.focus?.({ preventScroll: true })
    sourceElement.setSelectionRange?.(start, end)
    return true
  }
  const restoredRange = createContentEditableRangeFromOffsets(sourceElement, sourceRange)
  if (!restoredRange) return false
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection) return false
  try {
    sourceElement.focus?.({ preventScroll: true })
    selection.removeAllRanges()
    selection.addRange(restoredRange)
    return true
  } catch (error) {
    console.warn(error)
    return false
  }
}

function getNodeRect(node) {
  return node?.group?.node?.getBoundingClientRect?.() || null
}

function getNodeBodyRect(nodeOrUid) {
  const element = getNodeElement(nodeOrUid)
  if (!element) return null
  const bodyCandidateSelectors = [
    '.smm-node-shape',
    '.smm-hover-node',
    'foreignObject',
    '.smm-text-node-wrap',
    '.smm-richtext-node-wrap',
    '.smm-desctext-node-wrap',
  ]
  for (const selector of bodyCandidateSelectors) {
    const candidate = element.querySelector?.(selector)
    const rect = candidate?.getBoundingClientRect?.() || null
    if (isMeaningfulClientRect(rect)) return rect
  }
  const fallbackRect = element.getBoundingClientRect?.() || null
  return isMeaningfulClientRect(fallbackRect) ? fallbackRect : null
}

function getHostViewportRect() {
  const appRect = document.getElementById('app')?.getBoundingClientRect?.() || null
  if (isMeaningfulClientRect(appRect)) return appRect
  const width = window.innerWidth || document.documentElement?.clientWidth || 0
  const height = window.innerHeight || document.documentElement?.clientHeight || 0
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
  }
}

function centerNodeInViewport(node) {
  const rect = getNodeRect(node)
  const viewport = getHostViewportRect()
  if (!isMeaningfulClientRect(rect) || !viewport?.width || !viewport?.height) {
    return false
  }
  const deltaX = viewport.left + viewport.width / 2 - (rect.left + rect.width / 2)
  const deltaY = viewport.top + viewport.height / 2 - (rect.top + rect.height / 2)
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return true
  const mindMap = getMindMap()
  try {
    if (mindMap?.view && typeof mindMap.view.translateXY === 'function') {
      mindMap.view.translateXY(deltaX, deltaY)
      requestHostVisualRefresh()
      return true
    }
    if (
      mindMap?.view &&
      typeof mindMap.view.getTransformData === 'function' &&
      typeof mindMap.view.setTransformData === 'function'
    ) {
      const transformData = cloneValue(mindMap.view.getTransformData())
      if (transformData?.state) {
        transformData.state.x = Number(transformData.state.x || 0) + deltaX
        transformData.state.y = Number(transformData.state.y || 0) + deltaY
        transformData.state.sx = Number(transformData.state.sx || 0) + deltaX
        transformData.state.sy = Number(transformData.state.sy || 0) + deltaY
      }
      if (transformData?.transform) {
        if (typeof transformData.transform.translateX === 'number') {
          transformData.transform.translateX += deltaX
        }
        if (typeof transformData.transform.translateY === 'number') {
          transformData.transform.translateY += deltaY
        }
        if (Array.isArray(transformData.transform.translate)) {
          transformData.transform.translate[0] =
            Number(transformData.transform.translate[0] || 0) + deltaX
          transformData.transform.translate[1] =
            Number(transformData.transform.translate[1] || 0) + deltaY
        }
      }
      mindMap.view.setTransformData(transformData)
      requestHostVisualRefresh()
      return true
    }
  } catch (error) {
    console.warn(error)
  }
  if (mindMap?.view && typeof mindMap.view.fit === 'function') {
    try {
      mindMap.view.fit()
      requestHostVisualRefresh()
      return true
    } catch (error) {
      console.warn(error)
    }
  }
  return false
}

function getNodeLayoutDirection(node) {
  if (!node) return 'right'
  const parentNode = node.parent || null
  if (!parentNode) return 'right'
  const nodeCenter = getNodeCenter(node)
  const parentCenter = getNodeCenter(parentNode)
  return nodeCenter.x >= parentCenter.x ? 'right' : 'left'
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getPlaceholderMetrics(text, sourceRect) {
  const baseWidth = sourceRect?.width || 156
  const baseHeight = sourceRect?.height || 56
  const measuredWidth = clamp(Math.max(baseWidth, Math.min(String(text || '').length * 12 + 48, 240)), 132, 240)
  const measuredHeight = clamp(Math.max(baseHeight, 52), 52, 92)
  return {
    width: measuredWidth,
    height: measuredHeight,
  }
}

function makeRect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

function getSelectionDragParentKey(node) {
  const uid = getNodeUid(node)
  return uid || SELECTION_DRAG_ROOT_PARENT_KEY
}

function getSelectionDragChildrenByParentKey(parentKey) {
  if (parentKey === SELECTION_DRAG_ROOT_PARENT_KEY) {
    return getCachedNodes().filter(node => node && !node.isHide && !node.parent)
  }
  const parentNode = getNodeByUid(parentKey)
  return (Array.isArray(parentNode?.children) ? parentNode.children : []).filter(
    child => child && !child.isHide,
  )
}

function getSelectionDragVisibleNodeLayouts() {
  return getCachedNodes()
    .filter(node => node && !node.isHide)
    .map(node => {
      const uid = getNodeUid(node)
      const rect = getNodeRect(node)
      const bodyRect = getNodeBodyRect(node)
      if (!uid || !rect) return null
      return {
        node,
        uid,
        rect,
        bodyRect: isMeaningfulClientRect(bodyRect) ? bodyRect : rect,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        direction: node.parent ? getNodeLayoutDirection(node) : 'root',
        parentUid: getSelectionDragParentKey(node.parent || null),
      }
    })
    .filter(Boolean)
}

function collectSelectionDragExcludedNodeUids(node, excluded = new Set(), includeSelf = false) {
  if (!node) return excluded
  const uid = getNodeUid(node)
  if (uid && includeSelf) {
    excluded.add(uid)
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => collectSelectionDragExcludedNodeUids(child, excluded, true))
  }
  return excluded
}

function buildSelectionDragSiblingSlotBands(layouts) {
  const groups = new Map()
  layouts.forEach(layout => {
    const groupKey = `${layout.parentUid}::${layout.direction}`
    const current = groups.get(groupKey) || []
    current.push(layout)
    groups.set(groupKey, current)
  })

  const bands = []
  groups.forEach(group => {
    if (!Array.isArray(group) || group.length < 2) return
    const ordered = [...group].sort((left, right) => left.centerY - right.centerY)
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const current = ordered[index]
      const next = ordered[index + 1]
      const gapTop = current.rect.bottom
      const gapBottom = next.rect.top
      const gapHeight = Math.max(0, gapBottom - gapTop)
      const bandHeight = Math.max(SELECTION_DRAG_SLOT_MIN_HEIGHT, gapHeight)
      const slotCenterY = gapTop + (gapBottom - gapTop) / 2
      const pairLeft = Math.min(current.rect.left, next.rect.left)
      const pairRight = Math.max(current.rect.right, next.rect.right)
      const bandTop = slotCenterY - bandHeight / 2 - SELECTION_DRAG_SLOT_Y_EXPANSION
      const bandBottom = slotCenterY + bandHeight / 2 + SELECTION_DRAG_SLOT_Y_EXPANSION
      const lineInset = Math.min(18, Math.max(10, (pairRight - pairLeft) / 6))
      bands.push({
        current,
        next,
        centerY: slotCenterY,
        bandRect: {
          left: pairLeft - SELECTION_DRAG_SLOT_X_EXPANSION,
          top: bandTop,
          width: pairRight - pairLeft + SELECTION_DRAG_SLOT_X_EXPANSION * 2,
          height: bandBottom - bandTop,
          right: pairRight + SELECTION_DRAG_SLOT_X_EXPANSION,
          bottom: bandBottom,
        },
        slotRect: {
          left: pairLeft + lineInset,
          top: slotCenterY - 1.5,
          width: Math.max(48, pairRight - pairLeft - lineInset * 2),
          height: 3,
        },
      })
    }
  })
  return bands
}

function buildSelectionDragChildIntent(layouts, pointerX, pointerY, excludedNodeUids = null) {
  const hits = layouts
    .filter(layout => {
      if (excludedNodeUids?.has(layout.uid)) return false
      return pointInRect(layout.bodyRect || layout.rect, pointerX, pointerY)
    })
    .sort((left, right) => {
      const leftBodyRect = left.bodyRect || left.rect
      const rightBodyRect = right.bodyRect || right.rect
      const leftArea = leftBodyRect.width * leftBodyRect.height
      const rightArea = rightBodyRect.width * rightBodyRect.height
      if (leftArea !== rightArea) return leftArea - rightArea
      const leftCenterX = leftBodyRect.left + leftBodyRect.width / 2
      const leftCenterY = leftBodyRect.top + leftBodyRect.height / 2
      const rightCenterX = rightBodyRect.left + rightBodyRect.width / 2
      const rightCenterY = rightBodyRect.top + rightBodyRect.height / 2
      const leftDistance = Math.hypot(pointerX - leftCenterX, pointerY - leftCenterY)
      const rightDistance = Math.hypot(pointerX - rightCenterX, pointerY - rightCenterY)
      return leftDistance - rightDistance
    })
  const bestHit = hits[0] || null
  if (!bestHit) return null
  return {
    mode: 'child',
    anchorUid: bestHit.uid,
    parentUid: bestHit.uid,
    slotRect: null,
    highlightUid: bestHit.uid,
  }
}

function buildSelectionDragSiblingSlotIntent(slotBands, pointerX, pointerY) {
  let bestIntent = null
  let bestDistance = Number.POSITIVE_INFINITY

  slotBands.forEach(band => {
    if (!pointInRect(band.bandRect, pointerX, pointerY)) return
    const mode = pointerY <= band.centerY ? 'before' : 'after'
    const anchorLayout = mode === 'before' ? band.next : band.current
    const distance = Math.abs(pointerY - band.centerY)
    if (distance >= bestDistance) return

    bestDistance = distance
    bestIntent = {
      mode,
      anchorUid: anchorLayout.uid,
      parentUid: band.current.parentUid,
      slotRect: cloneValue(band.slotRect),
      highlightUid: anchorLayout.uid,
    }
  })

  return bestIntent
}

function buildSelectionDragIntent() {
  const layouts = getSelectionDragVisibleNodeLayouts()
  if (!layouts.length) {
    return buildEmptySelectionDragIntent()
  }

  const pointerX = selectionDragState.currentX
  const pointerY = selectionDragState.currentY
  const sourceNode = resolveSelectionDragSourceNode()
  const excludedNodeUids = collectSelectionDragExcludedNodeUids(sourceNode)
  const childIntent = buildSelectionDragChildIntent(
    layouts,
    pointerX,
    pointerY,
    excludedNodeUids,
  )
  if (childIntent) {
    return childIntent
  }
  const slotBands = buildSelectionDragSiblingSlotBands(layouts)
  const siblingIntent = buildSelectionDragSiblingSlotIntent(slotBands, pointerX, pointerY)
  if (siblingIntent) {
    return siblingIntent
  }

  return buildEmptySelectionDragIntent()
}

function updateSelectionDragPreview() {
  const elements = getSelectionDragLayerElements()
  if (!elements?.proxy) return
  const sourceNode = resolveSelectionDragSourceNode()
  selectionDragState.sourceNodeRect = getNodeRect(sourceNode) || selectionDragState.sourceNodeRect
  const intent = buildSelectionDragIntent()
  selectionDragState.dropIntent = intent
  applySelectionDragProxy(intent)
  applyNativeLikeDropPreview(intent)
}

function showSelectionDragPreview() {
  const elements = getSelectionDragLayerElements()
  if (!elements) return
  elements.layer.hidden = false
  updateSelectionDragPreview()
}

function hideSelectionDragPreview() {
  const elements = getSelectionDragLayerElements()
  if (!elements) return
  elements.proxy.hidden = true
  if (elements.slot) elements.slot.hidden = true
  clearSelectionDragLine()
  clearSelectionDragNodeClasses()
  clearSelectionDragLineDimming()
  elements.layer.hidden = true
}

function resetSelectionDragState() {
  const shouldKeepContextMenuBlock =
    (selectionDragState.stage === 'dragging' || selectionDragState.stage === 'pending') &&
    Number(selectionDragState.contextMenuBlockUntil || 0) > Date.now()
  setSelectionDragInteractionActive(false)
  clearSelectionDragHoldTimer()
  releaseSelectionDragPointerCapture()
  selectionDragState.pointerId = null
  selectionDragState.pointerButton = null
  selectionDragState.pointerCaptureElement = null
  selectionDragState.ownsPointerSequence = false
  selectionDragState.stage = 'idle'
  selectionDragState.holdReady = false
  selectionDragState.contextMenuBlockUntil = shouldKeepContextMenuBlock
    ? selectionDragState.contextMenuBlockUntil
    : 0
  selectionDragState.sourceNodeUid = null
  selectionDragState.sourceParentUid = null
  selectionDragState.sourceSiblingUids = []
  selectionDragState.sourceElement = null
  selectionDragState.sourceRange = null
  selectionDragState.sourceText = ''
  selectionDragState.sourceRect = null
  selectionDragState.sourceNodeRect = null
  selectionDragState.startX = 0
  selectionDragState.startY = 0
  selectionDragState.currentX = 0
  selectionDragState.currentY = 0
  selectionDragState.previewTargetNodeUid = null
  selectionDragState.previewTargetMode = 'cancel'
  selectionDragState.previewInsertionBarRect = null
  selectionDragState.previewProxyRect = null
  selectionDragState.dimmedNodeUids = []
  selectionDragState.dimmedLineNodes = []
  selectionDragState.dropIntent = buildEmptySelectionDragIntent()
  hideSelectionDragPreview()
}

function setEditableElementText(element, text) {
  if (!element) return false
  markHostInteraction()
  const nextText = String(text || '')
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    element.focus?.({ preventScroll: true })
    const currentValue = String(element.value || '')
    element.setSelectionRange?.(0, currentValue.length)
    if (typeof element.setRangeText === 'function') {
      element.setRangeText(nextText, 0, currentValue.length, 'end')
    } else {
      element.value = nextText
    }
    const caret = nextText.length
    element.setSelectionRange?.(caret, caret)
  } else {
    element.focus?.({ preventScroll: true })
    const selection =
      typeof window.getSelection === 'function' ? window.getSelection() : null
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(element)
      range.deleteContents()
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    const inserted =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, nextText)
    if (!inserted) {
      element.textContent = nextText
    }
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      data: nextText,
      inputType: 'insertText',
    }),
  )
  return true
}

function extractRangeTextFromEditable(element, range, text) {
  if (!element || !range || !text) return false
  const start = typeof range.start === 'number' ? range.start : null
  const end = typeof range.end === 'number' ? range.end : null
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    const normalizedStart = start == null ? 0 : start
    const normalizedEnd = end == null ? normalizedStart : end
    const value = String(element.value || '')
    const selectedText = value.slice(normalizedStart, normalizedEnd)
    if (!selectedText) return false
    element.focus?.({ preventScroll: true })
    if (typeof element.setRangeText === 'function') {
      element.setRangeText('', normalizedStart, normalizedEnd, 'start')
    } else {
      element.value = `${value.slice(0, normalizedStart)}${value.slice(normalizedEnd)}`
    }
    element.setSelectionRange?.(normalizedStart, normalizedStart)
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '',
        inputType: 'deleteContentBackward',
      }),
    )
    return true
  }
  const restoredRange = createContentEditableRangeFromOffsets(element, range)
  if (!restoredRange) return false
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  try {
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(restoredRange)
    }
    restoredRange.deleteContents()
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '',
        inputType: 'deleteContentBackward',
      }),
    )
    return true
  } catch (error) {
    console.warn(error)
    return false
  }
}

function resolveSelectionDragSourceNode() {
  if (selectionDragState.sourceNodeUid) {
    return getNodeByUid(selectionDragState.sourceNodeUid)
  }
  if (focusState.editingNodeUid) {
    return getNodeByUid(focusState.editingNodeUid)
  }
  return getCurrentActiveNode()
}

function snapshotSiblingUids(parentNode) {
  return new Set(
    getSelectionDragChildrenByParentKey(getSelectionDragParentKey(parentNode || null))
      .map(child => getNodeUid(child))
      .filter(Boolean),
  )
}

function findNewNodeFromParent(parentUid, previousChildUids) {
  const currentChildren = getSelectionDragChildrenByParentKey(parentUid)
  return (
    currentChildren.find(child => {
      const uid = getNodeUid(child)
      return uid && !previousChildUids.has(uid)
    }) ||
    currentChildren[currentChildren.length - 1] ||
    null
  )
}

function populateSelectionDragCreatedNode(node, text) {
  if (!node) return false

  activateNode(node, {
    notify: false,
    commit: true,
    visual: true,
    lockEditing: true,
  })
  enterEditModeForNode(node)
  window.setTimeout(() => {
    const editableElement = getActiveEditableElement()
    if (!editableElement) return
    setEditableElementText(editableElement, text)
    rememberFocusedNode(node, {
      notify: true,
      forceNotify: true,
      lockEditing: true,
    })
    scheduleModeSync()
  }, 24)
  return true
}

function finalizePendingSelectionDragCreation(options = {}) {
  const pendingCreation = selectionDragState.pendingCreation
  if (!pendingCreation) return false
  if (options.rendered) {
    pendingCreation.renderObserved = true
  }
  if (!pendingCreation.renderObserved && !options.force) {
    return false
  }

  const newNode = findNewNodeFromParent(
    pendingCreation.parentUid,
    new Set(pendingCreation.previousChildUids),
  )
  if (!newNode) return false

  selectionDragState.pendingCreation = null
  markHostInteraction()
  populateSelectionDragCreatedNode(newNode, pendingCreation.text)
  window.setTimeout(() => {
    populateSelectionDragCreatedNode(newNode, pendingCreation.text)
  }, 120)
  window.setTimeout(() => {
    populateSelectionDragCreatedNode(newNode, pendingCreation.text)
  }, 240)
  window.setTimeout(() => {
    finalizeSelectionDragHistoryEntry()
  }, 0)
  return true
}

function resolveSelectionDragCreationPlan(intent) {
  const renderer = getRenderer()
  if (!renderer || !intent || intent.mode === 'cancel') return null

  let anchorNode = null
  let command = null
  let parentNode = null

  if (intent.mode === 'child') {
    anchorNode = getNodeByUid(intent.anchorUid)
    parentNode = anchorNode
    command = renderer.insertChildNode
  } else if (intent.mode === 'before' || intent.mode === 'after') {
    anchorNode = getNodeByUid(intent.anchorUid)
    parentNode = anchorNode?.parent || null
    command = intent.mode === 'before' ? renderer.insertBefore : renderer.insertAfter
  }

  if (!anchorNode || typeof command !== 'function') return null

  const targetParentNode = intent.mode === 'child' ? anchorNode : parentNode
  return {
    renderer,
    anchorNode,
    command,
    parentUid: getSelectionDragParentKey(targetParentNode || null),
    previousChildUids: Array.from(snapshotSiblingUids(targetParentNode || null)),
  }
}

function createNodeFromSelectionDragIntent(intent, text, creationPlan = null) {
  const plan = creationPlan || resolveSelectionDragCreationPlan(intent)
  if (!plan || !text) return false

  activateNode(plan.anchorNode, {
    notify: false,
    commit: true,
    visual: true,
    clearEditingLock: true,
  })
  releaseEditableFocus()

  try {
    plan.command.call(plan.renderer)
  } catch (error) {
    console.warn(error)
    return false
  }

  selectionDragState.pendingCreation = {
    parentUid: plan.parentUid,
    previousChildUids: plan.previousChildUids,
    text,
    renderObserved: false,
  }

  ;[24, 120, 240, 480].forEach(delay => {
    window.setTimeout(() => {
      finalizePendingSelectionDragCreation({ force: delay >= 480 })
    }, delay)
  })
  return true
}

function commitSelectionDrag() {
  markHostInteraction()
  const selectedText = selectionDragState.sourceText
  const sourceElement = resolveSelectionDragSourceElement()
  const sourceRange = selectionDragState.sourceRange
  const intent = selectionDragState.dropIntent
  if (
    !selectedText ||
    !sourceElement ||
    !sourceRange ||
    !intent ||
    intent.mode === 'cancel' ||
    !hasMeaningfulSelectionDragText(selectedText)
  ) {
    resetSelectionDragState()
    return false
  }

  const creationPlan = resolveSelectionDragCreationPlan(intent)
  if (!creationPlan) {
    resetSelectionDragState()
    return false
  }

  beginSelectionDragHistoryEntry(selectedText)
  const extracted = extractRangeTextFromEditable(sourceElement, sourceRange, selectedText)
  if (!extracted) {
    discardPendingSelectionDragHistoryEntry()
    resetSelectionDragState()
    return false
  }

  const created = createNodeFromSelectionDragIntent(intent, selectedText, creationPlan)
  if (!created) {
    discardPendingSelectionDragHistoryEntry()
  }
  resetSelectionDragState()
  maybeFlushSoftSyncOnIdle()
  return created
}

function getTextBeforeCaret(element) {
  if (!element) return ''
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    const caret =
      typeof element.selectionStart === 'number' ? element.selectionStart : element.value.length
    return String(element.value || '').slice(0, caret)
  }
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection || selection.rangeCount <= 0) return ''
  const baseRange = selection.getRangeAt(0)
  const range = baseRange.cloneRange()
  range.selectNodeContents(element)
  range.setEnd(baseRange.endContainer, baseRange.endOffset)
  return range.toString()
}

function maybeTriggerBilinkSearchFromInput(event) {
  if (isReadonlyHost()) return
  const editableElement = getActiveEditableElement()
  if (!editableElement) return
  const insertedText = typeof event?.data === 'string' ? event.data : ''
  if (insertedText !== '@') return
  const beforeCaret = getTextBeforeCaret(editableElement)
  const match = beforeCaret.match(/(?:^|\s)@([^\s@\[\]]*)$/)
  if (!match) return
  if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
    bilinkState.pendingInsertion = {
      kind: 'text',
      element: editableElement,
      start:
        typeof editableElement.selectionStart === 'number'
          ? editableElement.selectionStart
          : String(editableElement.value || '').length,
      end:
        typeof editableElement.selectionEnd === 'number'
          ? editableElement.selectionEnd
          : String(editableElement.value || '').length,
      queryText: match[0],
    }
  } else {
    const selection =
      typeof window.getSelection === 'function' ? window.getSelection() : null
    bilinkState.pendingInsertion =
      selection && selection.rangeCount > 0
        ? {
            kind: 'rich',
            element: editableElement,
            range: selection.getRangeAt(0).cloneRange(),
            queryText: match[0],
          }
        : null
  }
  const rect = getEditableSelectionRect()
  const frameRect = window.frameElement?.getBoundingClientRect?.() || { left: 0, top: 0 }
  getHostBridge()?.notify?.('bilink_trigger', {
    nodeUid: focusState.editingNodeUid || focusState.committedNodeUid || null,
    left: frameRect.left + (rect?.left || 0),
    top: frameRect.top + (rect?.bottom || 0) + 8,
    query: match[1] || '',
  })
}

function insertBilinkMark(text) {
  const pending = bilinkState.pendingInsertion
  const editableElement =
    pending?.element && document.contains(pending.element)
      ? pending.element
      : getActiveEditableElement()
  if (!editableElement || !text) return false

  if (
    pending?.kind === 'text' &&
    (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT')
  ) {
    const start = typeof pending.start === 'number' ? pending.start : editableElement.value.length
    const end = typeof pending.end === 'number' ? pending.end : editableElement.value.length
    const value = String(editableElement.value || '')
    const prefix = value.slice(0, start)
    const suffix = value.slice(end)
    const queryText = String(pending.queryText || '@')
    const nextPrefix = prefix.endsWith(queryText)
      ? prefix.slice(0, Math.max(0, prefix.length - queryText.length))
      : prefix.replace(/@([^\s@\[\]]*)$/, '')
    editableElement.value = `${nextPrefix}${text}${suffix}`
    const caret = nextPrefix.length + text.length
    editableElement.setSelectionRange?.(caret, caret)
    editableElement.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    )
    bilinkState.pendingInsertion = null
    return true
  }

  if (pending?.kind === 'rich' && pending.range) {
    const selection =
      typeof window.getSelection === 'function' ? window.getSelection() : null
    if (!selection) return false
    const range = pending.range.cloneRange()
    try {
      selection.removeAllRanges()
      selection.addRange(range)
      if (
        range.startContainer &&
        range.startContainer.nodeType === Node.TEXT_NODE &&
        typeof pending.queryText === 'string'
      ) {
        const removeLength = pending.queryText.length
        const endOffset = range.endOffset
        const startOffset = Math.max(0, endOffset - removeLength)
        range.setStart(range.startContainer, startOffset)
        range.setEnd(range.endContainer, endOffset)
        range.deleteContents()
      }
      range.insertNode(document.createTextNode(text))
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
      editableElement.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: text,
          inputType: 'insertText',
        }),
      )
      bilinkState.pendingInsertion = null
      return true
    } catch (error) {
      console.warn(error)
    }
  }

  if (typeof document.execCommand === 'function') {
    editableElement.focus?.()
    document.execCommand('insertText', false, text)
    editableElement.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    )
    bilinkState.pendingInsertion = null
    return true
  }
  return false
}

window.insertBilinkMark = insertBilinkMark

function serializeNodes(nodes) {
  if (!Array.isArray(nodes)) return []
  return nodes
    .filter(Boolean)
    .map(node => serializeNode(node))
}

function buildSerializedNodeClickToken(serializedNodes) {
  if (!Array.isArray(serializedNodes) || serializedNodes.length === 0) return ''
  return serializedNodes
    .map(node =>
      node?.uid ||
      (node?.memoryAnkiId != null ? `memoryAnkiId:${node.memoryAnkiId}` : null) ||
      node?.text ||
      '',
    )
    .join('|')
}

function shouldDeduplicateReadonlyNodeClick(token, source) {
  if (!token) return false
  const now = Date.now()
  if (
    source === 'bus' &&
    readonlyNodeClickBridgeState.lastDomToken === token &&
    now - readonlyNodeClickBridgeState.lastDomAt < 48
  ) {
    return true
  }
  const scopedToken = `${source}:${token}`
  if (
    readonlyNodeClickBridgeState.lastToken === scopedToken &&
    readonlyNodeClickBridgeState.lastSource === source &&
    now - readonlyNodeClickBridgeState.lastAt < 24
  ) {
    return true
  }
  readonlyNodeClickBridgeState.lastToken = scopedToken
  readonlyNodeClickBridgeState.lastSource = source
  readonlyNodeClickBridgeState.lastAt = now
  if (source === 'dom') {
    readonlyNodeClickBridgeState.lastDomToken = token
    readonlyNodeClickBridgeState.lastDomAt = now
  }
  return false
}

function notifyHostNodeClick(serializedNodes, options = {}) {
  if (!Array.isArray(serializedNodes) || serializedNodes.length === 0) return false
  if (isReadonlyHost()) {
    const source = options?.source === 'dom' ? 'dom' : 'bus'
    const token = buildSerializedNodeClickToken(serializedNodes)
    if (shouldDeduplicateReadonlyNodeClick(token, source)) {
      return false
    }
  }
  getHostBridge()?.notify?.('node_click', serializedNodes)
  return true
}

function buildNodeTreeIndex() {
  const parentToChildren = new Map()
  const childToParent = new Map()
  const walk = node => {
    const uid = getNodeUid(node)
    if (!uid) return []
    const children = Array.isArray(node.children) ? node.children : []
    const nextChildUids = []
    children.forEach(child => {
      const childUid = getNodeUid(child)
      if (childUid) {
        nextChildUids.push(childUid)
        childToParent.set(childUid, uid)
      }
      walk(child)
    })
    parentToChildren.set(uid, nextChildUids)
    return nextChildUids
  }

  const root = getMindMap()?.renderer?.renderTree
  if (root) {
    walk(root)
  } else {
    getCachedNodes().forEach(node => {
      const uid = getNodeUid(node)
      if (!uid) return
      parentToChildren.set(
        uid,
        Array.isArray(node.children)
          ? node.children.map(child => getNodeUid(child)).filter(Boolean)
          : [],
      )
    })
  }
  segmentState.nodeParentToChildren = parentToChildren
  segmentState.nodeChildToParent = childToParent
}

function collectSubtreeUids(uid) {
  const visited = new Set()
  const walk = nextUid => {
    if (!nextUid || visited.has(nextUid)) return
    visited.add(nextUid)
    const children = segmentState.nodeParentToChildren.get(nextUid) || []
    children.forEach(walk)
  }
  walk(uid)
  return Array.from(visited)
}

function buildSegmentIndex() {
  const nextMap = new Map()
  getHostSegments().forEach(segment => {
    const nodeUids = Array.isArray(segment?.node_uids) ? segment.node_uids : []
    nodeUids.forEach(uid => {
      if (!uid || nextMap.has(uid)) return
      nextMap.set(String(uid), segment)
    })
  })
  segmentState.nodeUidToSegment = nextMap
}

function getStableFocusUid() {
  return (
    focusState.editingNodeUid ||
    focusState.committedNodeUid ||
    focusState.visualFocusNodeUid ||
    null
  )
}

function rememberFocusedNode(node, options = {}) {
  const uid = getNodeUid(node)
  if (!uid) return false

  const previousCommittedUid = focusState.committedNodeUid
  if (options.commit !== false) {
    focusState.committedNodeUid = uid
  }
  if (options.visual !== false) {
    focusState.visualFocusNodeUid = uid
  }
  if (options.lockEditing) {
    focusState.editingNodeUid = uid
  } else if (options.clearEditingLock) {
    focusState.editingNodeUid = null
  }

  updateKeyboardFocusClass()
  if (
    options.notify !== false &&
    (options.forceNotify || previousCommittedUid !== focusState.committedNodeUid)
  ) {
    notifyNodeActive(node)
  }
  return true
}

function resolveClosestExistingNode(uid) {
  let currentUid = uid || null
  const visited = new Set()
  while (currentUid && !visited.has(currentUid)) {
    visited.add(currentUid)
    const node = getNodeByUid(currentUid)
    if (node && !node.isHide) return node
    currentUid = segmentState.nodeChildToParent.get(currentUid) || null
  }
  return null
}

function resolveStableFocusNode() {
  if (focusState.editingNodeUid) {
    const editingNode = getNodeByUid(focusState.editingNodeUid)
    if (editingNode && !editingNode.isHide) return editingNode
    focusState.editingNodeUid = null
  }

  if (focusState.committedNodeUid) {
    const committedNode = resolveClosestExistingNode(focusState.committedNodeUid)
    focusState.committedNodeUid = committedNode ? getNodeUid(committedNode) : null
    if (committedNode) return committedNode
  }

  if (focusState.visualFocusNodeUid) {
    const visualNode = resolveClosestExistingNode(focusState.visualFocusNodeUid)
    focusState.visualFocusNodeUid = visualNode ? getNodeUid(visualNode) : null
    if (visualNode) return visualNode
  }

  return null
}

function restoreStableFocusAfterRender() {
  const activeNodes = Array.isArray(getRenderer()?.activeNodeList)
    ? getRenderer().activeNodeList
    : []
  if (activeNodes.length > 1) {
    updateKeyboardFocusClass()
    return false
  }
  const targetNode = resolveStableFocusNode()
  if (!targetNode) {
    updateKeyboardFocusClass()
    return false
  }

  const targetUid = getNodeUid(targetNode)
  focusState.visualFocusNodeUid = targetUid
  const activeNode = getRenderer()?.activeNodeList?.[0] || null
  const activeUid = getNodeUid(activeNode)
  if (!isReadonlyHost() && activeUid !== targetUid) {
    activateNode(targetNode, {
      notify: false,
      commit: false,
      visual: true,
      lockEditing: focusState.editingNodeUid === targetUid,
    })
    return true
  }

  updateKeyboardFocusClass()
  return false
}

function restorePendingSyncFocusIfNeeded() {
  if (!syncState.pendingFocusRestore) return false
  const snapshot = syncState.pendingFocusRestore
  syncState.pendingFocusRestore = null
  return restoreHostSyncFocusSnapshot(snapshot)
}

function restoreViewMemoryFocusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false
  const targetUid = snapshot.committedNodeUid || snapshot.visualFocusNodeUid || null
  const targetNode = resolveClosestExistingNode(targetUid)
  focusState.editingNodeUid = null
  if (!targetNode) {
    focusState.committedNodeUid = snapshot.committedNodeUid || null
    focusState.visualFocusNodeUid =
      snapshot.visualFocusNodeUid || snapshot.committedNodeUid || null
    updateKeyboardFocusClass()
    focusKeyboardSurface()
    return false
  }
  activateNode(targetNode, {
    notify: false,
    commit: true,
    visual: true,
    clearEditingLock: true,
  })
  focusKeyboardSurface()
  return true
}

function restorePendingViewMemoryFocusIfNeeded() {
  if (!syncState.pendingViewMemoryFocusRestore) return false
  const snapshot = syncState.pendingViewMemoryFocusRestore
  syncState.pendingViewMemoryFocusRestore = null
  return restoreViewMemoryFocusSnapshot(snapshot)
}

function restoreFocusRequest(request) {
  if (!request || typeof request !== 'object') return false
  const targetUid =
    typeof request.nodeUid === 'string' && request.nodeUid.trim()
      ? request.nodeUid.trim()
      : null
  if (!targetUid) return false
  const targetNode = resolveClosestExistingNode(targetUid)
  if (!targetNode) return false
  activateNode(targetNode, {
    notify: false,
    commit: true,
    visual: true,
    clearEditingLock: true,
  })
  focusKeyboardSurface()
  centerNodeInViewport(targetNode)
  updateKeyboardFocusClass()
  return true
}

function restorePendingFocusRequestIfNeeded(options = {}) {
  const request = syncState.pendingFocusRequest
  if (!request) return false
  const restored = restoreFocusRequest(request)
  if ((restored && options.clearOnSuccess !== false) || Number(request.attempts || 0) >= 4) {
    syncState.pendingFocusRequest = null
  } else {
    syncState.pendingFocusRequest = {
      ...request,
      attempts: Number(request.attempts || 0) + 1,
    }
  }
  return restored
}

function updateKeyboardFocusClass() {
  const targetUid = getStableFocusUid()
  getCachedNodes().forEach((node) => {
    const element = node?.group?.node
    if (!element?.classList) return
    if (getNodeUid(node) === targetUid) {
      element.classList.add(KEYBOARD_FOCUS_CLASS)
    } else {
      element.classList.remove(KEYBOARD_FOCUS_CLASS)
    }
  })
}

function getSegmentForNode(node) {
  const uid = getNodeUid(node)
  if (!uid) return null
  return segmentState.nodeUidToSegment.get(uid) || null
}

function applySegmentNodeStyles() {
  buildSegmentIndex()
  buildNodeTreeIndex()
  const activeSegmentId = getActiveSegmentId()
  const mode = getSegmentColorMode()
  const rangeDraft = getSegmentRangeDraft()
  const selectedNodeUids = new Set(rangeDraft.selectedNodeUids)
  const overriddenConflictNodeUids = new Set(rangeDraft.overriddenConflictNodeUids)
  getCachedNodes().forEach(node => {
    const segment = getSegmentForNode(node)
    const element = node?.group?.node
    if (!element?.style) return
    const uid = getNodeUid(node)
    element.classList.remove('memory-anki-segment-selected', 'memory-anki-segment-conflict-selected')
    if (!segment) {
      element.classList.remove('memory-anki-segment-active')
      element.style.removeProperty('--memory-anki-segment-color')
    } else {
      const shouldColor =
        mode === 'all' ||
        mode === 'all-with-active-emphasis' ||
        (mode === 'active-only' && activeSegmentId === Number(segment.id))
      if (!shouldColor) {
        element.classList.remove('memory-anki-segment-active')
        element.style.removeProperty('--memory-anki-segment-color')
      } else {
        element.style.setProperty('--memory-anki-segment-color', String(segment.color || '#14b8a6'))
        if (activeSegmentId != null && Number(segment.id) === activeSegmentId) {
          element.classList.add('memory-anki-segment-active')
        } else {
          element.classList.remove('memory-anki-segment-active')
        }
        const shape = element.querySelector('.smm-node-shape')
        if (shape?.style) {
          shape.style.stroke = String(segment.color || '#14b8a6')
          shape.style.strokeWidth = Number(activeSegmentId != null && Number(segment.id) === activeSegmentId ? 3 : 2)
          shape.style.filter =
            activeSegmentId != null && Number(segment.id) === activeSegmentId
              ? `drop-shadow(0 0 0 rgba(24, 24, 27, 0.12)) drop-shadow(0 0 10px ${String(segment.color || '#2563eb')}55)`
              : 'none'
        }
      }
    }
    if (rangeDraft.active && uid && selectedNodeUids.has(uid)) {
      element.classList.add('memory-anki-segment-selected')
      if (overriddenConflictNodeUids.has(uid)) {
        element.classList.add('memory-anki-segment-conflict-selected')
      }
    }
  })
}

function applyMiniPalaceNodeStyles() {
  const draft = getMiniPalaceDraft()
  const selectedNodeUids = new Set(draft.selectedNodeUids)
  getCachedNodes().forEach(node => {
    const element = node?.group?.node
    if (!element?.classList) return
    const uid = getNodeUid(node)
    element.classList.toggle(
      'memory-anki-mini-palace-selected',
      draft.active && Boolean(uid) && selectedNodeUids.has(uid)
    )
  })
}

function clearBilinkBadges() {
  const layer = document.querySelector('.memory-anki-bilink-badge-layer')
  if (layer) {
    layer.innerHTML = ''
  }
}

function resolveBilinkSourceForTargetUid(uid) {
  const palaceId = getCurrentPalaceId()
  const items = getBilinkItems()
  return (
    items.find(item => item.target_palace_id === palaceId && item.tgt_uid === uid) ||
    items.find(item => item.direction === 'incoming' && item.tgt_uid === uid) ||
    null
  )
}

function resolveBilinkTargetForSourceUid(uid) {
  const palaceId = getCurrentPalaceId()
  const items = getBilinkItems()
  return (
    items.find(item => item.source_palace_id === palaceId && item.src_uid === uid) || null
  )
}

function renderBilinkBadges() {
  clearBilinkBadges()
  const layer = document.querySelector('.memory-anki-bilink-badge-layer')
  if (!layer) return
  const counts = getBilinkCounts()
  Object.entries(counts).forEach(([uid, count]) => {
    if (!uid || !count) return
    const node = getNodeByUid(uid)
    const element = node?.group?.node
    if (!element || typeof element.getBoundingClientRect !== 'function') return
    const rect = element.getBoundingClientRect()
    const badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'memory-anki-bilink-badge'
    badge.textContent = String(count)
    badge.style.left = `${Math.max(0, rect.right - 12)}px`
    badge.style.top = `${Math.max(0, rect.top - 10)}px`
    badge.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const target = resolveBilinkSourceForTargetUid(uid)
      getHostBridge()?.notify?.('bilink_node_click', {
        palaceId: target?.source_palace_id || getCurrentPalaceId(),
        nodeUid: target?.src_uid || uid,
        trigger: 'badge',
      })
    })
    layer.appendChild(badge)
  })
}

function findNearestBilinkMark(target) {
  let current = target
  while (current && current !== document.body) {
    if (
      current.nodeType === Node.TEXT_NODE &&
      typeof current.textContent === 'string' &&
      /\[\[[^\]]+\]\]/.test(current.textContent)
    ) {
      return current
    }
    current = current.parentNode
  }
  return null
}

function registerBilinkListeners() {
  if (bilinkState.listenerRegistered) return
  bilinkState.listenerRegistered = true
  document.addEventListener(
    'input',
    event => {
      markHostInteraction()
      maybeTriggerBilinkSearchFromInput(event)
    },
    true,
  )
  document.addEventListener(
    'click',
    event => {
      if (isReadonlyHost()) return
      const markNode = findNearestBilinkMark(event.target)
      if (!markNode) return
      markHostInteraction()
      const activeUid = focusState.editingNodeUid || focusState.committedNodeUid || null
      if (!activeUid) return
      const target = resolveBilinkTargetForSourceUid(activeUid)
      getHostBridge()?.notify?.('bilink_node_click', {
        palaceId: target?.target_palace_id || getCurrentPalaceId(),
        nodeUid: target?.tgt_uid || activeUid,
        trigger: 'mark',
      })
    },
    true,
  )
  window.addEventListener('resize', () => {
    renderBilinkBadges()
    scheduleMindMapResizeSync()
  })
  document.addEventListener('scroll', renderBilinkBadges, true)
}

function closeSegmentMenu() {
  const menu = document.querySelector('.memory-anki-segment-menu')
  if (menu) menu.hidden = true
  segmentState.menuOpen = false
}

function renderSegmentMenu() {
  const menu = document.querySelector('.memory-anki-segment-menu')
  if (!menu) return
  const segments = getHostSegments()
  const activeSegmentId = getActiveSegmentId()
  menu.innerHTML = ''

  const title = document.createElement('div')
  title.className = 'memory-anki-segment-menu-title'
  title.textContent = '切换当前分块'
  menu.appendChild(title)

  const list = document.createElement('div')
  list.className = 'memory-anki-segment-menu-list'
  segments.forEach(segment => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'memory-anki-segment-menu-item'
    if (activeSegmentId != null && Number(segment.id) === activeSegmentId) {
      item.classList.add('is-active')
    }
    item.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:8px;min-width:0;">
        <span class="memory-anki-segment-color" style="background:${String(segment.color || '#14b8a6')}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(segment.name || '未命名分块')}</span>
      </span>
      <span style="color:#64748b;">${segment.created_at ? String(segment.created_at).replace('T', ' ').slice(0, 16) : '未设置'}</span>
    `
    item.addEventListener('click', () => {
      getHostBridge()?.notify?.('segment_select', Number(segment.id))
      closeSegmentMenu()
    })
    list.appendChild(item)
  })
  menu.appendChild(list)

  const actions = document.createElement('div')
  actions.className = 'memory-anki-segment-menu-actions'

  const createButton = document.createElement('button')
  createButton.type = 'button'
  createButton.className = 'memory-anki-segment-menu-item'
  createButton.textContent = '用当前选中创建分块'
  createButton.addEventListener('click', () => {
    void notifyParentUiAfterNativeFullscreenExit('segment_create_from_selection')
    closeSegmentMenu()
  })
  actions.appendChild(createButton)

  const clearButton = document.createElement('button')
  clearButton.type = 'button'
  clearButton.className = 'memory-anki-segment-menu-item'
  clearButton.textContent = '清除当前分块聚焦'
  clearButton.addEventListener('click', () => {
    getHostBridge()?.notify?.('segment_select', null)
    closeSegmentMenu()
  })
  actions.appendChild(clearButton)

  menu.appendChild(actions)
}

function notifySegmentRangeMode(active, targetSegmentId) {
  getHostBridge()?.notify?.('segment_range_mode_toggle', {
    active,
    targetSegmentId,
  })
}

function notifySegmentRangeDraftChange(selectedNodeUids, overriddenConflictNodeUids) {
  getHostBridge()?.notify?.('segment_range_draft_change', {
    selectedNodeUids,
    overriddenConflictNodeUids,
  })
}

function isNodeConflictForCurrentDraft(uid) {
  const rangeDraft = getSegmentRangeDraft()
  if (!uid) return false
  const owningSegment = segmentState.nodeUidToSegment.get(uid)
  if (!owningSegment) return false
  if (rangeDraft.targetSegmentId === 'new' || rangeDraft.targetSegmentId == null) return true
  return Number(owningSegment.id) !== Number(rangeDraft.targetSegmentId)
}

function toggleNodeInRangeDraft(node) {
  const rangeDraft = getSegmentRangeDraft()
  if (!rangeDraft.active) return false
  const uid = getNodeUid(node)
  if (!uid) return false

  const currentSelected = new Set(rangeDraft.selectedNodeUids)
  const currentOverrides = new Set(rangeDraft.overriddenConflictNodeUids)
  const subtreeUids = collectSubtreeUids(uid)
  const isSelected = currentSelected.has(uid)

  if (isSelected) {
    currentSelected.delete(uid)
    currentOverrides.delete(uid)
    notifySegmentRangeDraftChange(Array.from(currentSelected), Array.from(currentOverrides))
    return true
  }

  const subtreeSelection = []
  subtreeUids.forEach(subtreeUid => {
    if (subtreeUid === uid) {
      subtreeSelection.push(subtreeUid)
      return
    }
    if (!isNodeConflictForCurrentDraft(subtreeUid)) {
      subtreeSelection.push(subtreeUid)
    }
  })

  if (isNodeConflictForCurrentDraft(uid)) {
    currentOverrides.add(uid)
  }

  subtreeSelection.forEach(selectedUid => currentSelected.add(selectedUid))
  notifySegmentRangeDraftChange(Array.from(currentSelected), Array.from(currentOverrides))
  return true
}

async function exitNativeFullscreenIfNeeded() {
  // 原生全屏现在由父文档控制（对 iframe 元素 requestFullscreen），
  // iframe 内部不再直接操作全屏。这里仅作为兜底：
  // 若 iframe 自身意外进入全屏则退出，否则通知父文档。
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen?.()
    } catch (error) {
      console.warn(error)
    }
    return
  }
  getHostBridge()?.notify?.('exit_native_fullscreen_request', null)
}

async function enterNativeFullscreen() {
  // 原生全屏由父文档控制，iframe 内部仅发送请求通知。
  // 父文档会对 iframe 元素调用 requestFullscreen()，
  // 这样父文档的 Dialog/反馈层/庆祝 overlay 仍可正常渲染。
  getHostBridge()?.notify?.('enter_native_fullscreen_request', null)
}

async function notifyParentUiAfterNativeFullscreenExit(eventName, payload = null) {
  await exitNativeFullscreenIfNeeded()
  getHostBridge()?.notify?.(eventName, payload)
}

function isUiCleared() {
  return Boolean(uiChromeState.cleared)
}

function ensureRestoreUiButton() {
  let button = document.querySelector('.memory-anki-restore-ui-button')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'memory-anki-restore-ui-button'
    button.textContent = '显栏'
    button.hidden = true
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      setUiCleared(false)
    })
    document.body.appendChild(button)
  }
  button.hidden = !isUiCleared()
  return button
}

function ensureExitFullscreenButton() {
  let button = document.querySelector('.memory-anki-exit-fullscreen-button')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'memory-anki-exit-fullscreen-button'
    button.textContent = '退全屏'
    button.hidden = true
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      void exitNativeFullscreenIfNeeded()
    })
    document.body.appendChild(button)
  }
  // 检查 iframe 自身全屏 或 父文档全屏（iframe 元素作为全屏目标）
  const fullscreenActive = Boolean(document.fullscreenElement) || immersiveToggleState.parentFullscreenActive
  button.hidden = !fullscreenActive
  return button
}

function setUiCleared(nextValue) {
  uiChromeState.cleared = Boolean(nextValue)
  document.body.classList.toggle('memory-anki-ui-cleared', uiChromeState.cleared)
  if (uiChromeState.cleared) {
    closeSegmentMenu()
  }
  ensureRestoreUiButton()
  getHostBridge()?.notify?.('ui_cleared_change', uiChromeState.cleared)
}

function isImmersiveModeActive() {
  return Boolean(window.__memoryAnkiHostState?.immersiveModeActive)
}

function updateNavigatorFullscreenPresentation() {
  const buttonSelectors = [
    '.navigatorContainer .iconquanping',
    '.navigatorContainer .iconquanping1',
  ]
  buttonSelectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(button => {
      if (!(button instanceof HTMLElement)) return
      button.style.display = 'none'
      const item = button.closest('.item')
      if (item instanceof HTMLElement) {
        item.style.display = 'none'
      }
    })
  })
  ensureRestoreUiButton()
  ensureExitFullscreenButton()
}

function scheduleMindMapResizeSync() {
  const runResize = () => {
    const mindMap = getMindMap()
    if (!mindMap) return
    let resized = false
    try {
      if (typeof mindMap.resize === 'function') {
        mindMap.resize()
        resized = true
      }
    } catch (error) {
      console.warn(error)
    }
    requestResizeAwareHostVisualRefresh({
      fitChangedSize: resized,
    })
  }

  runResize()
  window.setTimeout(runResize, 32)
  window.setTimeout(runResize, 160)
}

function registerNativeFullscreenButtonStateSync() {
  if (immersiveToggleState.nativeFullscreenRegistered) return
  immersiveToggleState.nativeFullscreenRegistered = true
  document.addEventListener(
    'fullscreenchange',
    () => {
      updateNavigatorFullscreenPresentation()
      scheduleMindMapResizeSync()
    },
    true,
  )
  // 监听父文档触发的 resize 事件（父文档全屏切换时会 dispatch resize），
  // 同步父文档全屏状态到 iframe 内部，以便正确显示"退全屏"按钮。
  window.addEventListener('resize', () => {
    const wasParentActive = immersiveToggleState.parentFullscreenActive
    immersiveToggleState.parentFullscreenActive = Boolean(window.__memoryAnkiParentFullscreenActive)
    if (wasParentActive !== immersiveToggleState.parentFullscreenActive) {
      updateNavigatorFullscreenPresentation()
      scheduleMindMapResizeSync()
    }
  })
}

function getCurrentActiveNode() {
  const renderer = getRenderer()
  const activeNode = renderer?.activeNodeList?.[0] || null
  if (activeNode) return activeNode
  if (focusState.editingNodeUid) return getNodeByUid(focusState.editingNodeUid)
  if (focusState.committedNodeUid) return resolveClosestExistingNode(focusState.committedNodeUid)
  if (focusState.visualFocusNodeUid) return resolveClosestExistingNode(focusState.visualFocusNodeUid)
  return null
}

function activateNode(node, options = {}) {
  if (!node) return false
  const renderer = getRenderer()
  if (!renderer) return false
  try {
    if (options.clearExistingSelection !== false) {
      renderer.clearActiveNode?.()
    }
    node.active?.()
  } catch (error) {
    console.warn(error)
    return false
  }

  rememberFocusedNode(node, {
    notify: options.notify,
    forceNotify: options.forceNotify,
    commit: options.commit,
    visual: options.visual,
    lockEditing: options.lockEditing,
    clearEditingLock: options.clearEditingLock,
  })
  return true
}

function getNodeCenter(node) {
  return {
    x: Number(node?._left || 0) + Number(node?.width || 0) / 2,
    y: Number(node?._top || 0) + Number(node?.height || 0) / 2,
  }
}

function getDirectionalScore(currentNode, targetNode, direction, strict = true) {
  const current = getNodeCenter(currentNode)
  const target = getNodeCenter(targetNode)
  const dx = target.x - current.x
  const dy = target.y - current.y
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const epsilon = 4
  const horizontalDrift = absDy / Math.max(absDx, 1)
  const verticalDrift = absDx / Math.max(absDy, 1)

  if (direction === 'left') {
    if (dx >= -epsilon) return null
    if (strict && horizontalDrift > 0.8) return null
    return absDx * 10 + absDy * 4 + horizontalDrift * 40
  }
  if (direction === 'right') {
    if (dx <= epsilon) return null
    if (strict && horizontalDrift > 0.8) return null
    return absDx * 10 + absDy * 4 + horizontalDrift * 40
  }
  if (direction === 'up') {
    if (dy >= -epsilon) return null
    if (strict && verticalDrift > 0.8) return null
    return absDy * 10 + absDx * 4 + verticalDrift * 40
  }
  if (direction === 'down') {
    if (dy <= epsilon) return null
    if (strict && verticalDrift > 0.8) return null
    return absDy * 10 + absDx * 4 + verticalDrift * 40
  }
  return null
}

function findDirectionalTarget(direction) {
  const currentNode = getCurrentActiveNode()
  if (!currentNode) return null

  const candidates = getCachedNodes().filter((candidate) => {
    const candidateUid = getNodeUid(candidate)
    return candidateUid && candidateUid !== getNodeUid(currentNode) && !candidate.isHide
  })

  const pickBest = (strict) => {
    let bestNode = null
    let bestScore = Number.POSITIVE_INFINITY

    candidates.forEach((candidate) => {
      const score = getDirectionalScore(currentNode, candidate, direction, strict)
      if (score == null || score >= bestScore) return
      bestScore = score
      bestNode = candidate
    })

    return bestNode
  }

  return pickBest(true) || pickBest(false)
}

function scheduleModeSync() {
  window.setTimeout(() => {
    syncKeyboardMode()
    updateKeyboardFocusClass()
  }, 0)
  window.setTimeout(() => {
    syncKeyboardMode()
    restoreStableFocusAfterRender()
    updateKeyboardFocusClass()
  }, 120)
}

function getHistoryNavigationDirection(event) {
  const isMetaUndo = (event.metaKey || event.ctrlKey) && !event.altKey
  if (!isMetaUndo || event.repeat) return null
  const lowerKey = String(event.key || '').toLowerCase()
  if (lowerKey === 'z' && event.shiftKey) return 'forward'
  if (lowerKey === 'z') return 'back'
  if (lowerKey === 'y') return 'forward'
  return null
}

function deferEditableHistoryFallback(direction, editableElement) {
  const renderer = getRenderer()
  if (!direction || !editableElement || !renderer) return
  const beforeText = getEditableTextSnapshot(editableElement)
  const beforeSelection = getSelectionRangeSnapshotForElement(editableElement)
  const beforeFingerprint = getRuntimeMindMapDocumentFingerprint()
  const probeToken = ++selectionHistoryProbeState.token
  const probe = () => {
    if (probeToken !== selectionHistoryProbeState.token) return
    void beforeSelection
    const afterText = getEditableTextSnapshot(editableElement)
    const afterFingerprint = getRuntimeMindMapDocumentFingerprint()
    if (afterText !== beforeText) return
    if (afterFingerprint !== beforeFingerprint) return
    if (tryConsumeSelectionDragHistory(direction)) {
      scheduleModeSync()
      return
    }
    const historyMethod = direction === 'forward' ? renderer.forward : renderer.back
    if (typeof historyMethod !== 'function') return
    try {
      historyMethod.call(renderer)
      scheduleModeSync()
    } catch (error) {
      console.warn(error)
    }
  }

  window.setTimeout(() => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(probe)
      return
    }
    window.setTimeout(probe, 0)
  }, 0)
}

function enterEditModeForNode(node) {
  if (!node) return false
  const element = node?.group?.node
  if (!element) return false

  activateNode(node, {
    lockEditing: true,
  })
  const rect = element.getBoundingClientRect()
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: 2,
    view: window,
    clientX: Math.max(rect.left + Math.min(rect.width / 2, 18), 1),
    clientY: Math.max(rect.top + Math.min(rect.height / 2, 18), 1),
  }

  element.dispatchEvent(new MouseEvent('mousedown', eventInit))
  element.dispatchEvent(new MouseEvent('mouseup', eventInit))
  element.dispatchEvent(new MouseEvent('click', eventInit))
  element.dispatchEvent(new MouseEvent('dblclick', eventInit))
  scheduleModeSync()
  return true
}

function createChildAtActiveNode() {
  const renderer = getRenderer()
  let activeNode = getCurrentActiveNode()
  if (!renderer) return false
  if (!activeNode && focusState.committedNodeUid) {
    activeNode = resolveClosestExistingNode(focusState.committedNodeUid)
    if (activeNode) {
      activateNode(activeNode, {
        notify: false,
        commit: true,
        visual: true,
        clearEditingLock: true,
      })
    }
  }
  if (!activeNode) return false

  const parentUid = getNodeUid(activeNode)
  focusState.committedNodeUid = parentUid
  focusState.visualFocusNodeUid = parentUid
  focusState.editingNodeUid = null
  releaseEditableFocus()
  updateKeyboardFocusClass()

  try {
    renderer.insertChildNode?.()
  } catch (error) {
    console.warn(error)
    return false
  }

  const restoreParentKeyboardFocus = () => {
    const parentNode = getNodeByUid(parentUid)
    if (parentNode) {
      activateNode(parentNode, {
        notify: false,
        commit: true,
        visual: true,
        lockEditing: false,
      })
    }
    releaseEditableFocus()
    syncKeyboardMode()
    updateKeyboardFocusClass()
  }

  window.setTimeout(restoreParentKeyboardFocus, 0)
  window.setTimeout(restoreParentKeyboardFocus, 120)
  window.setTimeout(restoreParentKeyboardFocus, 240)

  return true
}

function deleteActiveNode() {
  const renderer = getRenderer()
  const activeNode = getCurrentActiveNode()
  if (!renderer || !activeNode) return false
  const activeUid = getNodeUid(activeNode)
  if (!activeUid) return false

  focusState.editingNodeUid = null
  releaseEditableFocus()

  const deleteMethods = [
    renderer.deleteNode,
    renderer.deleteCurrentNode,
    renderer.removeNode,
    renderer.removeCurrentNode,
  ].filter(method => typeof method === 'function')

  if (deleteMethods.length === 0) return false

  try {
    deleteMethods[0].call(renderer)
  } catch (error) {
    console.warn(error)
    return false
  }

  const restoreKeyboardState = () => {
    if (focusState.committedNodeUid === activeUid) {
      focusState.committedNodeUid = null
    }
    if (focusState.visualFocusNodeUid === activeUid) {
      focusState.visualFocusNodeUid = null
    }
    syncKeyboardMode()
    restoreStableFocusAfterRender()
    updateKeyboardFocusClass()
  }

  window.setTimeout(restoreKeyboardState, 0)
  window.setTimeout(restoreKeyboardState, 120)
  return true
}

function handleHostKeydown(event) {
  if (
    event.key === 'Escape' &&
    (selectionDragState.stage === 'pending' || selectionDragState.stage === 'dragging')
  ) {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
    resetSelectionDragState()
    maybeFlushSoftSyncOnIdle()
    return
  }

  if (event.key === 'Escape') {
    if (document.fullscreenElement) {
      event.preventDefault()
      event.stopPropagation()
      void exitNativeFullscreenIfNeeded()
      return
    }
    if (isImmersiveModeActive()) {
      event.preventDefault()
      event.stopPropagation()
      getHostBridge()?.notify?.('fullscreen_toggle', false)
      return
    }
  }

  if (isReadonlyHost() && !window.__memoryAnkiHostState?.miniPalacePracticeActive) return

  const renderer = getRenderer()
  const editableElement = getActiveEditableElement()
  focusState.mode = editableElement ? 'editing' : 'navigating'
  const historyDirection = getHistoryNavigationDirection(event)
  if (historyDirection) {
    markHostInteraction()
    if (focusState.mode === 'editing' && editableElement) {
      deferEditableHistoryFallback(historyDirection, editableElement)
      return
    }
    if (tryConsumeSelectionDragHistory(historyDirection)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const historyMethod = historyDirection === 'forward' ? renderer?.forward : renderer?.back
    if (typeof historyMethod === 'function') {
      event.preventDefault()
      event.stopPropagation()
      historyMethod.call(renderer)
      scheduleModeSync()
    }
    return
  }

  if (focusState.mode === 'editing') {
    if (event.key === 'Enter' && editableElement) {
      markHostInteraction()
      event.preventDefault()
      event.stopPropagation()
      insertLineBreakIntoEditable(editableElement)
      scheduleModeSync()
      return
    }
    return
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return

  if (event.key === 'ArrowLeft') {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    const target = findDirectionalTarget('left')
    if (target) activateNode(target)
    return
  }
  if (event.key === 'ArrowRight') {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    const target = findDirectionalTarget('right')
    if (target) activateNode(target)
    return
  }
  if (event.key === 'ArrowUp') {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    const target = findDirectionalTarget('up')
    if (target) activateNode(target)
    return
  }
  if (event.key === 'ArrowDown') {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    const target = findDirectionalTarget('down')
    if (target) activateNode(target)
    return
  }
  if (event.key === 'Enter') {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    enterEditModeForNode(getCurrentActiveNode())
    return
  }
  if (event.key === 'Tab' && !event.shiftKey) {
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    createChildAtActiveNode()
    return
  }
  if (event.key === ' ' || event.code === 'Space') {
    if (!window.__memoryAnkiHostState?.miniPalacePracticeActive) return
    if (!interactionState.lastHoveredNodeUid) return
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    getHostBridge()?.notify?.('mini_palace_pour', null)
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!getCurrentActiveNode()) return
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    deleteActiveNode()
    return
  }
}

function registerKeyboardListeners() {
  if (window.__memoryAnkiKeyboardListenersRegistered) return
  window.__memoryAnkiKeyboardListenersRegistered = true
  document.addEventListener('keydown', handleHostKeydown, true)
  document.addEventListener(
    'focusin',
    () => {
      markHostInteraction()
      syncKeyboardMode()
    },
    true,
  )
  document.addEventListener(
    'focusout',
    () => {
      markHostInteraction()
      scheduleModeSync()
      maybeFlushSoftSyncOnIdle()
    },
    true,
  )
}

function beginSelectionDragFromCandidate(event) {
  if (selectionDragState.stage !== 'pending') return false
  const sourceElement = resolveSelectionDragSourceElement()
  if (
    !sourceElement ||
    !selectionDragState.sourceRange ||
    !hasMeaningfulSelectionDragText(selectionDragState.sourceText)
  ) {
    resetSelectionDragState()
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
  if (!restoreSelectionDragSourceSelection()) {
    resetSelectionDragState()
    return false
  }
  selectionDragState.stage = 'dragging'
  selectionDragState.contextMenuBlockUntil = Date.now() + 1200
  setSelectionDragInteractionActive(true)
  showSelectionDragPreview()
  emitHostFeedback('drag_start', {
    source: 'selection_drag',
    nodeUid: selectionDragState.sourceNodeUid || null,
    x: event.clientX,
    y: event.clientY,
  })
  emitFeedbackFx({
    type: 'drag_start',
    nodeUid: selectionDragState.sourceNodeUid || null,
    relatedNodeUids: selectionDragState.sourceNodeUid ? [selectionDragState.sourceNodeUid] : [],
    intensity: 'full',
    lineMode: 'spawn',
    nonce: Date.now(),
    x: event.clientX,
    y: event.clientY,
  })
  return true
}

function registerSelectionDragListeners() {
  if (window.__memoryAnkiSelectionDragRegistered) return
  window.__memoryAnkiSelectionDragRegistered = true

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (isReadonlyHost()) return
      if (event.button !== 2) return
      if (getSegmentRangeDraft().active) return
      const candidate = getSelectionDragCandidateContext(
        event.target,
        event.clientX,
        event.clientY,
      )
      if (!candidate) return
      const {
        editableElement,
        selectionText,
        selectionRange,
        selectionRect,
        sourceNode,
      } = candidate
      const sourceParentNode = sourceNode?.parent || null
      suppressSelectionDragNativePointerEvent(event, { capturePointer: true })
      selectionDragState.pointerId = event.pointerId
      selectionDragState.pointerButton = event.button
      selectionDragState.ownsPointerSequence = true
      selectionDragState.stage = 'pending'
      selectionDragState.holdReady = false
      selectionDragState.contextMenuBlockUntil = Date.now() + SELECTION_DRAG_HOLD_DELAY + 1200
      selectionDragState.sourceNodeUid = getNodeUid(sourceNode) || focusState.editingNodeUid || null
      selectionDragState.sourceParentUid = getSelectionDragParentKey(sourceParentNode)
      selectionDragState.sourceSiblingUids = (Array.isArray(sourceParentNode?.children) ? sourceParentNode.children : [])
        .map(child => getNodeUid(child))
        .filter(Boolean)
      selectionDragState.sourceElement = editableElement
      selectionDragState.sourceRange = selectionRange
      selectionDragState.sourceText = selectionText
      selectionDragState.sourceRect = selectionRect
      selectionDragState.sourceNodeRect = getNodeRect(sourceNode)
      selectionDragState.startX = event.clientX
      selectionDragState.startY = event.clientY
      selectionDragState.currentX = event.clientX
      selectionDragState.currentY = event.clientY
      markHostInteraction()
      armSelectionDragHoldTimer()
    },
    true,
  )

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!ownsSelectionDragPointer(event) || selectionDragState.stage === 'idle') return
      suppressSelectionDragNativePointerEvent(event)
      selectionDragState.currentX = event.clientX
      selectionDragState.currentY = event.clientY
      markHostInteraction()
      if (selectionDragState.stage === 'pending') {
        const sourceElement = resolveSelectionDragSourceElement()
        if (
          !sourceElement ||
          !selectionDragState.sourceRange ||
          !document.contains(sourceElement)
        ) {
          resetSelectionDragState()
          return
        }
        const distance = Math.hypot(
          event.clientX - selectionDragState.startX,
          event.clientY - selectionDragState.startY,
        )
        if (!selectionDragState.holdReady) {
          if (distance > SELECTION_DRAG_PRE_HOLD_TOLERANCE) {
            resetSelectionDragState()
          }
          return
        }
        if (distance < SELECTION_DRAG_ACTIVATION_DISTANCE) return
        if (!beginSelectionDragFromCandidate(event)) return
      }
      if (selectionDragState.stage === 'dragging') {
        restoreSelectionDragSourceSelection()
        updateSelectionDragPreview()
      }
    },
    true,
  )

  document.addEventListener(
    'pointerup',
    (event) => {
      if (!ownsSelectionDragPointer(event) || selectionDragState.stage === 'idle') return
      suppressSelectionDragNativePointerEvent(event)
      markHostInteraction()
      if (selectionDragState.stage === 'dragging') {
        restoreSelectionDragSourceSelection()
        emitHostFeedback('drag_drop', {
          source: 'selection_drag',
          nodeUid: selectionDragState.previewTargetNodeUid || selectionDragState.sourceNodeUid || null,
          x: event.clientX,
          y: event.clientY,
        })
        emitFeedbackFx({
          type: 'drag_drop',
          nodeUid: selectionDragState.previewTargetNodeUid || selectionDragState.sourceNodeUid || null,
          relatedNodeUids: [
            selectionDragState.sourceNodeUid,
            selectionDragState.previewTargetNodeUid,
          ].filter(Boolean),
          intensity: 'full',
          lineMode: 'confirm',
          nonce: Date.now(),
          x: event.clientX,
          y: event.clientY,
        })
        commitSelectionDrag()
        return
      }
      resetSelectionDragState()
    },
    true,
  )

  document.addEventListener(
    'pointercancel',
    (event) => {
      if (!ownsSelectionDragPointer(event) && selectionDragState.stage === 'idle') return
      markHostInteraction()
      resetSelectionDragState()
      maybeFlushSoftSyncOnIdle()
    },
    true,
  )

  document.addEventListener(
    'lostpointercapture',
    (event) => {
      if (!ownsSelectionDragPointer(event)) return
      markHostInteraction()
      resetSelectionDragState()
      maybeFlushSoftSyncOnIdle()
    },
    true,
  )

  window.addEventListener('blur', () => {
    if (!selectionDragState.ownsPointerSequence) return
    markHostInteraction()
    resetSelectionDragState()
    maybeFlushSoftSyncOnIdle()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') return
    if (!selectionDragState.ownsPointerSequence) return
    markHostInteraction()
    resetSelectionDragState()
    maybeFlushSoftSyncOnIdle()
  })

  document.addEventListener(
    'selectstart',
    (event) => {
      if (selectionDragState.stage !== 'dragging') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      restoreSelectionDragSourceSelection()
    },
    true,
  )

  document.addEventListener(
    'dragstart',
    (event) => {
      if (selectionDragState.stage === 'pending') {
        markHostInteraction()
        resetSelectionDragState()
        return
      }
      if (selectionDragState.stage === 'dragging') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        restoreSelectionDragSourceSelection()
      }
    },
    true,
  )

  document.addEventListener(
    'contextmenu',
    (event) => {
      if (!shouldSuppressSelectionDragContextMenu()) return
      markHostInteraction()
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
    },
    true,
  )
}

function registerPointerIntentListener() {
  if (window.__memoryAnkiPointerIntentRegistered) return
  window.__memoryAnkiPointerIntentRegistered = true
  document.addEventListener(
    'pointerdown',
    event => {
      markHostInteraction()
      if (isReadonlyPracticeMode()) return
      if (interactionState.pointerIntentClearTimer != null) {
        window.clearTimeout(interactionState.pointerIntentClearTimer)
        interactionState.pointerIntentClearTimer = null
      }
      const node = getNodeByElement(event.target)
      const nodeUid = getNodeUid(node) || null
      emitHostFeedback('pointer_down', {
        source: 'pointerdown',
        nodeUid,
        x: event.clientX,
        y: event.clientY,
        throttleKey: `pointer_down:${event.pointerId || 'mouse'}`,
        throttleMs: 24,
      })
      createFeedbackRipple(event.clientX, event.clientY, event.button === 2 ? 'context_menu' : 'pointer_down')
      if (nodeUid) {
        emitFeedbackFx({
          type: 'pointer_down',
          nodeUid,
          relatedNodeUids: [nodeUid],
          intensity: 'soft',
          lineMode: 'trace',
          nonce: Date.now(),
          x: event.clientX,
          y: event.clientY,
        })
      }
      if (isReadonlyHost()) return
      interactionState.pointerDownNodeUid = getNodeUid(node) || null
      interactionState.pointerDownWithModifier = Boolean(
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
      )
    },
    true
  )
  document.addEventListener(
    'pointerup',
    event => {
      markHostInteraction()
      if (isReadonlyPracticeMode()) return
      emitHostFeedback('pointer_click', {
        source: 'pointerup',
        x: event.clientX,
        y: event.clientY,
        throttleKey: `pointer_click:${event.pointerId || 'mouse'}`,
        throttleMs: 36,
      })
      if (isReadonlyHost()) return
      if (interactionState.pointerIntentClearTimer != null) {
        window.clearTimeout(interactionState.pointerIntentClearTimer)
      }
      interactionState.pointerIntentClearTimer = window.setTimeout(() => {
        interactionState.pointerDownNodeUid = null
        interactionState.pointerDownWithModifier = false
        interactionState.pointerIntentClearTimer = null
        maybeFlushSoftSyncOnIdle()
      }, 220)
    },
    true
  )
}

function registerContextMenuListener() {
  if (window.__memoryAnkiContextMenuRegistered) return
  window.__memoryAnkiContextMenuRegistered = true
  document.addEventListener(
    'contextmenu',
    event => {
      markHostInteraction()
      if (!isReadonlyPracticeMode()) {
        const feedbackNode = getNodeByElement(event.target, {
          event,
          allowReadonlyFallback: true,
        })
        const feedbackNodeUid = getNodeUid(feedbackNode) || null
        emitHostFeedback('context_menu', {
          source: 'contextmenu',
          nodeUid: feedbackNodeUid,
          x: event.clientX,
          y: event.clientY,
          throttleKey: `context_menu:${feedbackNodeUid || 'canvas'}`,
          throttleMs: 80,
        })
        createFeedbackRipple(event.clientX, event.clientY, 'context_menu')
        if (feedbackNodeUid) {
          emitFeedbackFx({
            type: 'context_menu',
            nodeUid: feedbackNodeUid,
            relatedNodeUids: [feedbackNodeUid],
            intensity: 'full',
            lineMode: 'trace',
            nonce: Date.now(),
            x: event.clientX,
            y: event.clientY,
          })
        }
      }
      const miniPalaceDraft = getMiniPalaceDraft()
      if (!isReadonlyHost() && !miniPalaceDraft.active) return
      const node = getNodeByElement(event.target, {
        event,
        allowReadonlyFallback: isReadonlyHost() || miniPalaceDraft.active,
      })
      if (!node) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      getHostBridge()?.notify?.('node_contextmenu', [serializeNode(node)])
    },
    true
  )
}

function registerEditableDoubleClickListener() {
  if (window.__memoryAnkiEditableDoubleClickRegistered) return
  window.__memoryAnkiEditableDoubleClickRegistered = true
  document.addEventListener(
    'dblclick',
    event => {
      if (isReadonlyHost()) return
      markHostInteraction()
      const node = getNodeByElement(event.target)
      if (!node) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        return
      }
      rememberFocusedNode(node, {
        notify: true,
        lockEditing: true,
      })
      const nodeUid = getNodeUid(node) || null
      emitHostFeedback('node_edit_start', {
        source: 'dblclick',
        nodeUid,
        x: event.clientX,
        y: event.clientY,
      })
      if (nodeUid) {
        emitFeedbackFx({
          type: 'node_edit_start',
          nodeUid,
          relatedNodeUids: [nodeUid],
          intensity: 'full',
          lineMode: 'spawn',
          nonce: Date.now(),
          x: event.clientX,
          y: event.clientY,
        })
      }
      scheduleModeSync()
    },
    true
  )
}

function getKeydownFeedbackType(event) {
  if (event.repeat) return null
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  const editing = Boolean(getActiveEditableElement() || focusState.editingNodeUid)
  if (editing) {
    if (
      event.key.length === 1 ||
      event.key === 'Enter' ||
      event.key === 'Backspace' ||
      event.key === 'Delete' ||
      event.key === 'Process' ||
      event.key === 'Unidentified'
    ) {
      return 'key_press'
    }
    return null
  }
  if (!getCurrentActiveNode()) return null
  if (event.key === 'Enter') return 'node_edit_start'
  if (event.key === 'Tab' && !event.shiftKey) return 'node_create'
  if (event.key === 'Delete' || event.key === 'Backspace') return 'node_delete'
  return null
}

function registerFeedbackInputListeners() {
  if (window.__memoryAnkiFeedbackInputRegistered) return
  window.__memoryAnkiFeedbackInputRegistered = true
  document.addEventListener(
    'keydown',
    event => {
      markHostInteraction()
      const type = getKeydownFeedbackType(event)
      if (!type) return
      const activeNodeUid = focusState.editingNodeUid || focusState.committedNodeUid || focusState.visualFocusNodeUid || null
      emitHostFeedback(type, {
        source: 'keydown',
        nodeUid: activeNodeUid,
        throttleKey: `key:${type}:${event.key}:${activeNodeUid || 'canvas'}`,
        throttleMs: type === 'key_press' ? 64 : 120,
      })
      if (activeNodeUid) {
        emitFeedbackFx({
          type,
          nodeUid: activeNodeUid,
          relatedNodeUids: [activeNodeUid],
          intensity: type === 'key_press' ? 'soft' : 'full',
          lineMode:
            type === 'key_press'
              ? 'trace'
              : type === 'node_delete'
                ? 'clear'
                : type === 'node_edit_start'
                  ? 'spawn'
                  : 'confirm',
          nonce: Date.now(),
        })
      }
    },
    true,
  )
  document.addEventListener(
    'click',
    event => {
      const target = event.target
      const element = target instanceof Element ? target.closest('button,[role="button"],.toolbarBtn,.el-button,.item') : null
      if (!element) return
      const node = getNodeByElement(target)
      const nodeUid = getNodeUid(node) || focusState.committedNodeUid || null
      emitHostFeedback('toolbar_action', {
        source: 'clickable',
        nodeUid,
        x: event.clientX,
        y: event.clientY,
        throttleKey: `toolbar:${String(element.textContent || element.className || 'button').slice(0, 32)}`,
        throttleMs: 80,
      })
      emitFeedbackFx({
        type: 'toolbar_action',
        nodeUid,
        relatedNodeUids: nodeUid ? [nodeUid] : [],
        intensity: 'soft',
        lineMode: 'trace',
        nonce: Date.now(),
        x: event.clientX,
        y: event.clientY,
      })
    },
    true,
  )
}

function registerReadonlyClickListener() {
  if (window.__memoryAnkiReadonlyClickRegistered) return
  window.__memoryAnkiReadonlyClickRegistered = true
  const handleReadonlyPrimaryActivate = event => {
    const rangeDraft = getSegmentRangeDraft()
    const miniPalaceDraft = getMiniPalaceDraft()
    if (!isReadonlyHost() && !rangeDraft.active && !miniPalaceDraft.active) return
    if (typeof event.button === 'number' && event.button !== 0) return
    const node = getNodeByElement(event.target, {
      event,
      allowReadonlyFallback: isReadonlyHost(),
    })
    if (!node) return
    markHostInteraction()
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
    const nodeUid = getNodeUid(node) || null
    if (rangeDraft.active) {
      emitHostFeedback('segment_action', {
        source: 'segment_range_toggle',
        nodeUid,
        x: event.clientX,
        y: event.clientY,
      })
      emitFeedbackFx({
        type: 'segment_action',
        nodeUid,
        relatedNodeUids: nodeUid ? [nodeUid] : [],
        intensity: 'full',
        lineMode: 'confirm',
        nonce: Date.now(),
        x: event.clientX,
        y: event.clientY,
      })
      toggleNodeInRangeDraft(node)
      return
    }
    if (miniPalaceDraft.active) {
      emitHostFeedback('segment_action', {
        source: 'mini_palace_select_toggle',
        nodeUid,
        x: event.clientX,
        y: event.clientY,
      })
      notifyHostNodeClick([serializeNode(node)], { source: 'dom' })
      return
    }
    notifyHostNodeClick([serializeNode(node)], { source: 'dom' })
  }
  document.addEventListener(
    'pointerup',
    event => {
      handleReadonlyPrimaryActivate(event)
    },
    true
  )
  document.addEventListener(
    'click',
    event => {
      handleReadonlyPrimaryActivate(event)
    },
    true
  )
}

function registerReadonlyHoverListener() {
  if (window.__memoryAnkiReadonlyHoverRegistered) return
  window.__memoryAnkiReadonlyHoverRegistered = true
  document.addEventListener(
    'pointermove',
    event => {
      if (!isReadonlyHost() && !window.__memoryAnkiHostState?.miniPalacePracticeActive) return
      const node = getNodeByElement(event.target, {
        event,
        allowReadonlyFallback: true,
      })
      const nodeUid = node ? (getNodeUid(node) || null) : null
      if (nodeUid === interactionState.lastHoveredNodeUid) return
      interactionState.lastHoveredNodeUid = nodeUid
      if (nodeUid) {
        getHostBridge()?.notify?.('node_hover', [serializeNode(node)])
      }
    },
    true
  )
}

function registerFullscreenListener() {
  if (window.__memoryAnkiFullscreenListenerRegistered) return
  window.__memoryAnkiFullscreenListenerRegistered = true
  document.addEventListener('fullscreenchange', () => {
    emitHostFeedback('mode_switch', {
      source: 'native_fullscreen',
      throttleKey: 'native_fullscreen',
      throttleMs: 120,
    })
    getHostBridge()?.notify?.('fullscreen_change', Boolean(document.fullscreenElement))
  })
}

function serializeNode(node) {
  const data = getNodeData(node)
  return {
    uid: data.uid || null,
    text: typeof data.text === 'string' ? data.text : '',
    note: typeof data.note === 'string' ? data.note : '',
    memoryAnkiId:
      data.memoryAnkiId == null || data.memoryAnkiId === ''
        ? null
        : Number(data.memoryAnkiId),
    memoryAnkiNodeType:
      typeof data.memoryAnkiNodeType === 'string' ? data.memoryAnkiNodeType : null,
    rawData: data,
  }
}

function isAiSplitBusy() {
  return Boolean(window.__memoryAnkiHostState?.aiSplitBusy)
}

function isAiSplitEnabled() {
  return Boolean(window.__memoryAnkiHostState?.aiSplitEnabled)
}

function getAiSplitButtonLabel() {
  return isAiSplitBusy() ? 'AI分卡中...' : 'AI分卡'
}

function getToolbarButtonPlainText(button) {
  return String(button?.textContent || '').replace(/\s+/g, '').trim()
}

function buildAiSplitRequestPayload() {
  const runtimeRoot = getMindMap()?.renderer?.renderTree || null
  const targetNode = getCurrentActiveNode() || runtimeRoot
  if (!targetNode) return null
  const serialized = serializeNode(targetNode)
  const isRoot = Boolean(runtimeRoot && targetNode === runtimeRoot)
  if (!isRoot && !serialized.uid) {
    return null
  }
  return {
    target_node_uid: isRoot ? null : serialized.uid || null,
    target_node_text: serialized.text || '',
    target_node_note: serialized.note || '',
    target_node_type: serialized.memoryAnkiNodeType || null,
    is_root: isRoot,
    selection_snapshot: {
      target_node_uid: isRoot ? null : serialized.uid || null,
      target_node_type: serialized.memoryAnkiNodeType || null,
      is_root: isRoot,
    },
  }
}

function handleAiSplitToolbarClick(event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
  if (isReadonlyHost() || !isAiSplitEnabled() || isAiSplitBusy()) return
  const payload = buildAiSplitRequestPayload()
  if (!payload) return
  markHostInteraction()
  emitHostFeedback('toolbar_action', {
    source: 'ai_split_toolbar',
    nodeUid: payload.target_node_uid || null,
    x: event.clientX,
    y: event.clientY,
  })
  emitFeedbackFx({
    type: 'toolbar_action',
    nodeUid: payload.target_node_uid || null,
    relatedNodeUids: payload.target_node_uid ? [payload.target_node_uid] : [],
    intensity: 'full',
    lineMode: 'spawn',
    nonce: Date.now(),
    x: event.clientX,
    y: event.clientY,
  })
  getHostBridge()?.notify?.('ai_split_request', payload)
}

function syncAiSplitToolbarButtons() {
  const buttons = Array.from(document.querySelectorAll('.toolbarNodeBtnList .toolbarBtn'))
  buttons.forEach(button => {
    if (!(button instanceof HTMLElement)) return
    const plainText = getToolbarButtonPlainText(button)
    if (button.dataset.memoryAnkiAiSplitButton === 'true') {
      button.hidden = isReadonlyHost()
      button.textContent = getAiSplitButtonLabel()
      button.classList.toggle('is-disabled', isAiSplitBusy() || !isAiSplitEnabled())
      button.style.opacity = isAiSplitBusy() || !isAiSplitEnabled() ? '0.58' : ''
      button.setAttribute('aria-disabled', isAiSplitBusy() || !isAiSplitEnabled() ? 'true' : 'false')
      button.title = isAiSplitEnabled() ? '' : '当前页面暂不支持 AI 分卡'
      return
    }
    if (plainText !== 'AI续写') return
    const replacement = button.cloneNode(true)
    if (!(replacement instanceof HTMLElement)) return
    replacement.dataset.memoryAnkiAiSplitButton = 'true'
    replacement.textContent = getAiSplitButtonLabel()
    replacement.hidden = isReadonlyHost()
    replacement.classList.toggle('is-disabled', isAiSplitBusy() || !isAiSplitEnabled())
    replacement.style.opacity = isAiSplitBusy() || !isAiSplitEnabled() ? '0.58' : ''
    replacement.setAttribute('aria-disabled', isAiSplitBusy() || !isAiSplitEnabled() ? 'true' : 'false')
    replacement.title = isAiSplitEnabled() ? '' : '当前页面暂不支持 AI 分卡'
    replacement.addEventListener('click', handleAiSplitToolbarClick, true)
    button.replaceWith(replacement)
  })
}

function applyFocusNodeStyles() {
  const focusNodeUids = new Set(getFocusNodeUids())
  getCachedNodes().forEach(node => {
    const element = node?.group?.node
    if (!element?.classList) return
    const uid = getNodeUid(node)
    element.classList.toggle('memory-anki-focus-card', Boolean(uid && focusNodeUids.has(uid)))
  })
}

function scheduleAiSplitToolbarPatch() {
  if (aiSplitToolbarState.patchScheduled) return
  aiSplitToolbarState.patchScheduled = true
  window.requestAnimationFrame(() => {
    aiSplitToolbarState.patchScheduled = false
    syncAiSplitToolbarButtons()
  })
}

function ensureAiSplitToolbarObserver() {
  if (aiSplitToolbarState.observerRegistered) return
  aiSplitToolbarState.observerRegistered = true
  const observer = new MutationObserver(() => {
    scheduleAiSplitToolbarPatch()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
  scheduleAiSplitToolbarPatch()
}

function applyHostState(nextState) {
  const previousState = window.__memoryAnkiHostState || {}
  const wasReadonly = Boolean(previousState.readonly)
  const wasImmersiveModeActive = Boolean(previousState.immersiveModeActive)
  const wasPracticeModeActive = Boolean(previousState.practiceModeActive)
  window.__memoryAnkiHostState = {
    ...previousState,
    ...(nextState || {}),
  }
  const previousViewMemoryScope = normalizeViewMemoryScope(previousState.viewMemoryScope)
  const nextViewMemoryScope = getCurrentViewMemoryScope()
  if (previousViewMemoryScope !== nextViewMemoryScope) {
    saveViewMemoryScopeSnapshot(previousViewMemoryScope)
    queueViewMemoryScopeRestore(nextViewMemoryScope)
  }
  const previousFocusRequestNonce = Number(previousState.focusRequestNonce || 0)
  const nextFocusRequestNonce = Number(window.__memoryAnkiHostState.focusRequestNonce || 0)
  const nextFocusRequestNodeUid =
    typeof window.__memoryAnkiHostState.focusRequestNodeUid === 'string' &&
    window.__memoryAnkiHostState.focusRequestNodeUid.trim()
      ? window.__memoryAnkiHostState.focusRequestNodeUid.trim()
      : null
  if (nextFocusRequestNonce !== previousFocusRequestNonce) {
    syncState.pendingFocusRequest = nextFocusRequestNodeUid
      ? {
          nodeUid: nextFocusRequestNodeUid,
          nonce: nextFocusRequestNonce,
          attempts: 0,
        }
      : null
  }
  const isReadonly = Boolean(window.__memoryAnkiHostState.readonly)
  const readonlyHost = isReadonly
  document.body.classList.toggle('is-host-readonly', readonlyHost)
  document.body.classList.remove('is-host-readonly-toolbar-visible')
  document.body.classList.toggle(
    'memory-anki-review-fx-enabled',
    isReadonly && Boolean(window.__memoryAnkiHostState.practiceModeActive)
  )
  const appRoot =
    document.getElementById('app')?.__vue__ ||
    document.getElementById('app')?.firstElementChild?.__vue__ ||
    null
  const store = appRoot && appRoot.$store
  if (store) {
    store.commit('setIsReadonly', readonlyHost)
    if (readonlyHost) {
      store.commit('setActiveSidebar', null)
    }
  }
  const mindMap = window.__memoryAnkiMindMapInstance
  if (!mindMap) return
  if (typeof window.__memoryAnkiHostState.readonly === 'boolean') {
    const nextMode = readonlyHost ? 'readonly' : 'edit'
    const currentMode =
      typeof mindMap.opt?.mode === 'string'
        ? mindMap.opt.mode
        : typeof mindMap.mode === 'string'
          ? mindMap.mode
          : null
    if (currentMode !== nextMode) {
      mindMap.setMode(nextMode)
    }
  }
  if (isReadonly && !wasReadonly) {
    resetReadonlyInteractionState()
  } else if (!isReadonly) {
    clearReviewFxState()
    window.setTimeout(() => {
      restoreStableFocusAfterRender()
    }, 0)
  }
  if (
    !Boolean(window.__memoryAnkiHostState.practiceModeActive) &&
    wasPracticeModeActive
  ) {
    clearReviewFxState()
  }
  window.setTimeout(() => {
    applyUnifiedMindMapAppearance()
    updateKeyboardFocusClass()
    applyFocusNodeStyles()
    applySegmentNodeStyles()
    applyMiniPalaceNodeStyles()
    updateNavigatorFullscreenPresentation()
    renderBilinkBadges()
    restorePendingFocusRequestIfNeeded({ clearOnSuccess: false })
  }, 0)
  ensureRestoreUiButton()
  applyUnifiedMindMapAppearance()
  updateKeyboardFocusClass()
  applyFocusNodeStyles()
  applySegmentNodeStyles()
  applyMiniPalaceNodeStyles()
  updateNavigatorFullscreenPresentation()
  renderBilinkBadges()
  scheduleAiSplitToolbarPatch()
  if (wasImmersiveModeActive !== isImmersiveModeActive()) {
    emitHostFeedback('mode_switch', {
      source: 'immersive_mode',
      throttleKey: 'immersive_mode',
      throttleMs: 150,
    })
    scheduleMindMapResizeSync()
  }
  if (wasReadonly !== isReadonly || wasPracticeModeActive !== Boolean(window.__memoryAnkiHostState.practiceModeActive)) {
    emitHostFeedback('mode_switch', {
      source: 'host_state_mode',
      throttleKey: 'host_state_mode',
      throttleMs: 150,
    })
  }
}

window.applyHostState = applyHostState
window.emitReviewFx = emitReviewFx
window.emitFeedbackFx = emitFeedbackFx
window.clearReviewFx = clearReviewFxState
window.setUiCleared = setUiCleared
window.toggleUiCleared = () => setUiCleared(!isUiCleared())
window.enterNativeFullscreen = enterNativeFullscreen
window.exitNativeFullscreen = exitNativeFullscreenIfNeeded

function resetReadonlyInteractionState() {
  clearReviewFxState()
  focusState.editingNodeUid = null
  focusState.visualFocusNodeUid = focusState.committedNodeUid
  syncKeyboardMode()
  try {
    getRenderer()?.clearActiveNode?.()
  } catch (error) {
    console.warn(error)
  }
  updateKeyboardFocusClass()
}

window.resetReadonlyInteractionState = resetReadonlyInteractionState

const HOST_IMPORTED_NODE_AUTO_WIDTH_THRESHOLD = 12
const HOST_IMPORTED_NODE_LEGACY_MEDIUM_TEXT_WIDTH = 132
const HOST_IMPORTED_NODE_WIDE_TEXT_WIDTH = 220
const HOST_IMPORTED_NODE_EXTRA_WIDE_TEXT_WIDTH = 320
const HOST_IMPORTED_NODE_MEASURE_PADDING = 28
let importedNodeMeasureContext = null

function stripHtmlToText(value) {
  const html = typeof value === 'string' ? value : ''
  if (!html) return ''
  const temp = document.createElement('div')
  temp.innerHTML = html
  return String(temp.textContent || temp.innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getImportedNodeMeasureContext() {
  if (importedNodeMeasureContext) return importedNodeMeasureContext
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  const canvas = document.createElement('canvas')
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null
  if (!context) return null
  context.font = '560 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  importedNodeMeasureContext = context
  return importedNodeMeasureContext
}

function measureImportedNodeTextWidth(plainText) {
  const normalizedText = typeof plainText === 'string' ? plainText.trim() : ''
  if (!normalizedText) return 0
  const context = getImportedNodeMeasureContext()
  if (context?.measureText) {
    return Math.ceil(context.measureText(normalizedText).width)
  }
  return normalizedText.length * 13
}

function resolveImportedNodeTextWidth(plainText) {
  const textLength = typeof plainText === 'string' ? plainText.length : 0
  if (textLength < HOST_IMPORTED_NODE_AUTO_WIDTH_THRESHOLD) return null
  const measuredTextWidth = measureImportedNodeTextWidth(plainText)
  const desiredWidth = measuredTextWidth + HOST_IMPORTED_NODE_MEASURE_PADDING
  if (textLength >= 78 || desiredWidth > HOST_IMPORTED_NODE_WIDE_TEXT_WIDTH) {
    return HOST_IMPORTED_NODE_EXTRA_WIDE_TEXT_WIDTH
  }
  if (textLength >= 34 || desiredWidth > HOST_IMPORTED_NODE_LEGACY_MEDIUM_TEXT_WIDTH) {
    return HOST_IMPORTED_NODE_WIDE_TEXT_WIDTH
  }
  return null
}

function hasLegacyImportedMediumTextWidth(value) {
  return Number(value) === HOST_IMPORTED_NODE_LEGACY_MEDIUM_TEXT_WIDTH
}

function normalizeImportedNodePresentation(node, depth = 0) {
  if (!node || typeof node !== 'object') return
  const data = node.data && typeof node.data === 'object' ? node.data : null
  if (data && depth > 0) {
    const plainText = stripHtmlToText(data.text)
    const targetWidth = resolveImportedNodeTextWidth(plainText)
    const currentCustomTextWidth = Number(data.customTextWidth)
    const hasLegacyMediumTextWidth = hasLegacyImportedMediumTextWidth(data.customTextWidth)
    if (typeof targetWidth === 'number') {
      if (
        hasLegacyMediumTextWidth ||
        !Number.isFinite(currentCustomTextWidth) ||
        currentCustomTextWidth !== targetWidth
      ) {
        data.customTextWidth = targetWidth
      }
    } else if (hasLegacyMediumTextWidth || Number.isFinite(currentCustomTextWidth)) {
      delete data.customTextWidth
    }
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => normalizeImportedNodePresentation(child, depth + 1))
  }
}

function buildNodeDeduplicationKey(node, childKeys) {
  if (!node || typeof node !== 'object') return '__empty__'
  const data = node.data && typeof node.data === 'object' ? node.data : {}
  const uid =
    typeof data.uid === 'string' && data.uid.trim().length > 0 ? data.uid.trim() : null
  if (uid) {
    return `uid:${uid}`
  }
  return JSON.stringify({
    text: typeof data.text === 'string' ? data.text : '',
    note: typeof data.note === 'string' ? data.note : '',
    richText: Boolean(data.richText),
    memoryAnkiNodeType:
      typeof data.memoryAnkiNodeType === 'string' ? data.memoryAnkiNodeType : '',
    children: childKeys,
  })
}

function dedupeImportedNodeTree(node) {
  if (!node || typeof node !== 'object') {
    return '__empty__'
  }
  if (!Array.isArray(node.children) || node.children.length === 0) {
    node.children = Array.isArray(node.children) ? node.children : []
    return buildNodeDeduplicationKey(node, [])
  }

  const seenChildKeys = new Set()
  const dedupedChildren = []
  const childKeys = []

  node.children.forEach((child) => {
    const childKey = dedupeImportedNodeTree(child)
    if (seenChildKeys.has(childKey)) {
      return
    }
    seenChildKeys.add(childKey)
    dedupedChildren.push(child)
    childKeys.push(childKey)
  })

  node.children = dedupedChildren
  return buildNodeDeduplicationKey(node, childKeys)
}

function getRuntimeNodeDataContainer(node) {
  if (!node) return null
  try {
    const whole = typeof node.getData === 'function' ? node.getData() : null
    if (whole && typeof whole === 'object') {
      return whole
    }
  } catch (error) {
    console.warn(error)
  }
  if (node.nodeData?.data && typeof node.nodeData.data === 'object') {
    return node.nodeData.data
  }
  if (node.data && typeof node.data === 'object') {
    return node.data
  }
  return null
}

function applyDocMetadataToRuntimeNode(runtimeNode, nextDocNode) {
  if (!runtimeNode || !nextDocNode) return
  const targetData = getRuntimeNodeDataContainer(runtimeNode)
  const nextData = cloneValue(getDocNodeData(nextDocNode))
  if (targetData && nextData) {
    Object.assign(targetData, nextData)
  }
  if (runtimeNode.nodeData?.data && typeof runtimeNode.nodeData.data === 'object') {
    Object.assign(runtimeNode.nodeData.data, nextData)
  }
  if (runtimeNode.data && typeof runtimeNode.data === 'object') {
    Object.assign(runtimeNode.data, nextData)
  }
  const runtimeChildren = Array.isArray(runtimeNode.children) ? runtimeNode.children : []
  const nextChildren = getDocNodeChildren(nextDocNode)
  nextChildren.forEach((childNode, index) => {
    applyDocMetadataToRuntimeNode(runtimeChildren[index], childNode)
  })
}

function applySoftMergedEditorState(nextEditorState, nextFingerprint) {
  if (!canSoftMergeEditorState(nextEditorState)) return false
  const runtimeRoot = getMindMap()?.renderer?.renderTree || null
  const nextRoot = getEditorDocRoot(nextEditorState.editor_doc)
  if (!runtimeRoot || !nextRoot) return false
  applyDocMetadataToRuntimeNode(runtimeRoot, nextRoot)
  window.__memoryAnkiPendingEditorState = {
    editorState: cloneValue(nextEditorState),
    preserveView: true,
    syncIntent: 'soft',
    viewPolicy: 'preserve',
    fingerprint: nextFingerprint,
  }
  markLastAppliedEditorFingerprint(nextFingerprint, 'soft')
  requestHostVisualRefresh()
  updateKeyboardFocusClass()
  return true
}

function requestHostVisualRefresh() {
  const mindMap = getMindMap()
  const renderer = getRenderer()
  const refreshCalls = [
    typeof renderer?.render === 'function' ? () => renderer.render() : null,
    typeof renderer?.reRender === 'function' ? () => renderer.reRender() : null,
    typeof renderer?.refresh === 'function' ? () => renderer.refresh() : null,
    typeof renderer?.draw?.render === 'function' ? () => renderer.draw.render() : null,
    typeof mindMap?.render === 'function' ? () => mindMap.render() : null,
    typeof mindMap?.refresh === 'function' ? () => mindMap.refresh() : null,
    typeof mindMap?.view?.render === 'function' ? () => mindMap.view.render() : null,
    typeof mindMap?.view?.update === 'function' ? () => mindMap.view.update() : null,
  ]
  for (const run of refreshCalls) {
    try {
      if (typeof run !== 'function') continue
      const result = run()
      if (typeof result !== 'undefined') {
        break
      }
    } catch (error) {
      console.warn(error)
    }
  }
  window.setTimeout(() => {
    applyUnifiedMindMapAppearance()
    updateKeyboardFocusClass()
    applySegmentNodeStyles()
    applyMiniPalaceNodeStyles()
    renderBilinkBadges()
  }, 0)
}

function getHostViewportSizeSignature() {
  const app = document.getElementById('app')
  const rect = app?.getBoundingClientRect?.()
  const width = Math.round(rect?.width || window.innerWidth || 0)
  const height = Math.round(rect?.height || window.innerHeight || 0)
  return `${width}x${height}`
}

function requestResizeAwareHostVisualRefresh(options = {}) {
  const nextSizeSignature = getHostViewportSizeSignature()
  const sizeChanged =
    !viewportRefreshState.lastSizeSignature ||
    viewportRefreshState.lastSizeSignature !== nextSizeSignature
  viewportRefreshState.lastSizeSignature = nextSizeSignature
  viewportRefreshState.fitRequested =
    viewportRefreshState.fitRequested ||
    Boolean(options.fitChangedSize && sizeChanged)
  if (viewportRefreshState.scheduled) return
  viewportRefreshState.scheduled = true
  const run = () => {
    viewportRefreshState.scheduled = false
    const shouldFit = viewportRefreshState.fitRequested
    viewportRefreshState.fitRequested = false
    requestHostVisualRefresh()
    if (!shouldFit) return
    window.setTimeout(() => {
      const mindMap = getMindMap()
      if (!mindMap?.view || typeof mindMap.view.fit !== 'function') return
      try {
        mindMap.view.fit()
      } catch (error) {
        console.warn(error)
      }
      requestHostVisualRefresh()
    }, 0)
  }
  window.requestAnimationFrame(() => {
    run()
    window.requestAnimationFrame(run)
  })
}

function captureHostSyncFocusSnapshot() {
  const activeNode = getCurrentActiveNode()
  const editableElement = getActiveEditableElement()
  return {
    activeNodeUid: getNodeUid(activeNode) || null,
    focusSnapshot: captureSelectionDragFocusSnapshot(),
    selectionRange: editableElement ? getSelectionRangeSnapshotForElement(editableElement) : null,
    selectionText: editableElement ? getEditableSelectionTextForElement(editableElement) : '',
    wasEditing: Boolean(editableElement),
  }
}

function restoreHostSyncFocusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false
  const targetUid = snapshot.activeNodeUid || snapshot.focusSnapshot?.editingNodeUid || null
  const targetNode = resolveClosestExistingNode(targetUid)
  if (!targetNode) {
    restoreSelectionDragFocusSnapshot(snapshot.focusSnapshot)
    focusKeyboardSurface()
    return false
  }

  activateNode(targetNode, {
    notify: false,
    commit: true,
    visual: true,
    lockEditing: Boolean(snapshot.wasEditing),
    clearEditingLock: !snapshot.wasEditing,
  })

  if (!snapshot.wasEditing) {
    updateKeyboardFocusClass()
    focusKeyboardSurface()
    return true
  }

  const restoreEditableSelection = () => {
    const editableElement = getNodeEditableElement(targetNode) || getActiveEditableElement()
    if (!editableElement) return false
    const selectionRange = snapshot.selectionRange
    if (selectionRange && restoreSelectionDragSourceSelectionForSnapshot(editableElement, selectionRange)) {
      return true
    }
    return false
  }

  enterEditModeForNode(targetNode)
  window.setTimeout(() => {
    if (!restoreEditableSelection()) {
      restoreSelectionDragFocusSnapshot(snapshot.focusSnapshot)
    }
  }, 24)
  window.setTimeout(() => {
    restoreEditableSelection()
  }, 120)
  return true
}

function restoreSelectionDragSourceSelectionForSnapshot(editableElement, selectionRange) {
  if (!editableElement || !selectionRange) return false
  if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
    const start = typeof selectionRange.start === 'number' ? selectionRange.start : null
    const end = typeof selectionRange.end === 'number' ? selectionRange.end : null
    if (start == null || end == null) return false
    editableElement.focus?.({ preventScroll: true })
    editableElement.setSelectionRange?.(start, end)
    return true
  }
  const restoredRange = createContentEditableRangeFromOffsets(editableElement, selectionRange)
  if (!restoredRange) return false
  const selection =
    typeof window.getSelection === 'function' ? window.getSelection() : null
  if (!selection) return false
  try {
    editableElement.focus?.({ preventScroll: true })
    selection.removeAllRanges()
    selection.addRange(restoredRange)
    return true
  } catch (error) {
    console.warn(error)
    return false
  }
}

function schedulePendingSoftSyncFlush() {
  clearPendingSoftSyncTimers()
  if (!syncState.pendingSoftPayload) return
  syncState.flushTimer = window.setTimeout(() => {
    flushPendingSoftSync()
  }, SOFT_SYNC_BUSY_WINDOW + 24)
  syncState.maxFlushTimer = window.setTimeout(() => {
    flushPendingSoftSync(true)
  }, SOFT_SYNC_MAX_DEFER_MS)
}

function flushPendingSoftSync(force = false) {
  const pendingPayload = syncState.pendingSoftPayload
  if (!pendingPayload) return false
  if (!force && isSoftSyncBusy()) {
    schedulePendingSoftSyncFlush()
    return false
  }
  if (shouldDiscardStalePendingSoftPayload(pendingPayload)) {
    syncState.pendingSoftPayload = null
    clearPendingSoftSyncTimers()
    return false
  }
  syncState.pendingSoftPayload = null
  clearPendingSoftSyncTimers()
  return performEditorStateSync(pendingPayload)
}

function performFullEditorSync(payload) {
  const nextEditorState = payload?.editorState
  if (!nextEditorState) return false
  const nextFingerprint =
    payload?.fingerprint ||
    buildEditorStateFingerprint(nextEditorState, Boolean(payload?.preserveView))
  const mindMap = window.__memoryAnkiMindMapInstance
  if (!mindMap) return false

  const nextDoc = cloneValue(nextEditorState.editor_doc) || {}
  normalizeImportedNodePresentation(nextDoc?.root, 0)
  dedupeImportedNodeTree(nextDoc?.root)
  const nextConfig = cloneValue(nextEditorState.editor_config) || {}
  const viewPolicy = payload?.viewPolicy === 'reset' ? 'reset' : 'preserve'
  if (
    viewPolicy !== 'reset' &&
    window.__memoryAnkiLastAppliedFullEditorFingerprint &&
    window.__memoryAnkiLastAppliedFullEditorFingerprint === nextFingerprint
  ) {
    return true
  }
  const viewMemoryRestore = consumePendingViewMemoryScopeRestore()
  let currentTransform = null
  const focusSnapshot = viewMemoryRestore ? null : captureHostSyncFocusSnapshot()
  if (viewPolicy === 'reset' && !viewMemoryRestore) {
    delete nextDoc.view
  }
  if (viewMemoryRestore?.transform) {
    currentTransform = cloneValue(viewMemoryRestore.transform)
    delete nextDoc.view
  } else if (Boolean(payload?.preserveView)) {
    try {
      if (mindMap.view && typeof mindMap.view.getTransformData === 'function') {
        currentTransform = cloneValue(mindMap.view.getTransformData())
      }
    } catch (error) {
      console.warn(error)
    }
    delete nextDoc.view
  }

  if (typeof mindMap.setFullData === 'function') {
    mindMap.setFullData(nextDoc)
  } else if (typeof mindMap.setData === 'function') {
    mindMap.setData(nextDoc)
  }

  if (typeof mindMap.updateConfig === 'function') {
    mindMap.updateConfig(nextConfig)
  }

  requestHostVisualRefresh()
  ensureMindMapShortcutGuard()
  markLastAppliedEditorFingerprint(nextFingerprint, 'full')
  markInitialHydrationComplete(nextFingerprint)
  syncState.pendingViewFitAfterRender =
    viewPolicy === 'reset' && payload?.syncReason === 'review_flip'
  syncState.pendingFocusRestore = focusSnapshot
  syncState.pendingViewMemoryFocusRestore = viewMemoryRestore

  if (currentTransform) {
    window.__memoryAnkiPendingTransformRestore = cloneValue(currentTransform)
  }
  return true
}

function performEditorStateSync(payload) {
  const nextEditorState = payload?.editorState
  if (!nextEditorState) return false
  const nextFingerprint =
    payload?.fingerprint ||
    buildEditorStateFingerprint(nextEditorState, Boolean(payload?.preserveView))
  const syncIntent = payload?.syncIntent === 'replace' ? 'replace' : 'soft'
  if (syncIntent === 'soft' && applySoftMergedEditorState(nextEditorState, nextFingerprint)) {
    return true
  }
  return performFullEditorSync({
    ...payload,
    fingerprint: nextFingerprint,
    syncIntent,
  })
}

function syncHostEditorState(payload) {
  const nextEditorState = payload?.editorState
  if (!nextEditorState) return

  const syncReason = typeof payload?.syncReason === 'string' ? payload.syncReason : null
  const nextFingerprint = buildEditorStateFingerprint(
    nextEditorState,
    Boolean(payload?.preserveView),
  )
  if (!window.__memoryAnkiPendingEditorState) {
    window.__memoryAnkiPendingEditorState = {}
  }
  window.__memoryAnkiPendingEditorState = {
    editorState: cloneValue(nextEditorState),
    preserveView: Boolean(payload?.preserveView),
    syncIntent: payload?.syncIntent === 'replace' ? 'replace' : 'soft',
    syncReason,
    viewPolicy: payload?.viewPolicy === 'reset' ? 'reset' : 'preserve',
    fingerprint: nextFingerprint,
  }

  const mindMap = window.__memoryAnkiMindMapInstance
  if (!mindMap) return
  if ((payload?.syncIntent || 'soft') === 'replace') {
    syncState.pendingSoftPayload = null
    clearPendingSoftSyncTimers()
  }
  if ((payload?.syncIntent || 'soft') === 'soft' && applySoftMergedEditorState(nextEditorState, nextFingerprint)) {
    return
  }
  if (
    (payload?.syncIntent || 'soft') === 'soft' &&
    !isImmediateSoftSyncReason(syncReason) &&
    isSoftSyncBusy()
  ) {
    syncState.pendingSoftPayload = {
      ...cloneValue(payload),
      fingerprint: nextFingerprint,
      syncIntent: 'soft',
      syncReason,
    }
    schedulePendingSoftSyncFlush()
    return
  }
  performEditorStateSync({
    ...payload,
    fingerprint: nextFingerprint,
    syncIntent: payload?.syncIntent === 'replace' ? 'replace' : 'soft',
  })
}

window.syncHostEditorState = syncHostEditorState

function setupTakeOverMethods() {
  const bootstrapEditorState = getPreferredHostEditorStateSnapshot()
  window.__memoryAnkiBootstrapEditorFingerprint = buildEditorStateFingerprint(
    bootstrapEditorState,
    false,
  )
  window.takeOverAppMethods = {
    getMindMapData() {
      return cloneValue(getPreferredHostEditorStateSnapshot().editor_doc) || null
    },
    saveMindMapData(data) {
      if (!canWriteBackToHost()) return
      const nextFingerprint = buildEditorStateFingerprint(
        {
          editor_doc: cloneValue(data) || {},
          editor_config: cloneValue(getPreferredHostEditorStateSnapshot().editor_config) || {},
          editor_local_config:
            cloneValue(getPreferredHostEditorStateSnapshot().editor_local_config) || {},
          lang: getPreferredHostEditorStateSnapshot().lang || 'zh',
        },
        false,
      )
      if (
        !syncState.initialHydrationComplete &&
        syncState.lastServerSyncedFingerprint &&
        nextFingerprint === window.__memoryAnkiBootstrapEditorFingerprint &&
        nextFingerprint !== syncState.lastServerSyncedFingerprint
      ) {
        return
      }
      getHostBridge()?.saveMindMapData?.(cloneValue(data))
      emitHostFeedback('save_success', {
        source: 'save_mindmap_data',
        nodeUid: focusState.editingNodeUid || focusState.committedNodeUid || null,
        throttleKey: 'save_mindmap_data',
        throttleMs: 180,
      })
      emitFeedbackFx({
        type: 'save_success',
        nodeUid: focusState.editingNodeUid || focusState.committedNodeUid || null,
        relatedNodeUids: [focusState.editingNodeUid || focusState.committedNodeUid].filter(Boolean),
        intensity: 'soft',
        lineMode: 'confirm',
        nonce: Date.now(),
      })
      updatePendingEditorStateBaseline({
        editor_doc: cloneValue(data) || {},
      })
    },
    getMindMapConfig() {
      return cloneValue(getPreferredHostEditorStateSnapshot().editor_config) || {}
    },
    saveMindMapConfig(config) {
      if (!canWriteBackToHost()) return
      getHostBridge()?.saveMindMapConfig?.(cloneValue(config))
      emitHostFeedback('save_success', {
        source: 'save_mindmap_config',
        throttleKey: 'save_mindmap_config',
        throttleMs: 220,
      })
      updatePendingEditorStateBaseline({
        editor_config: cloneValue(config) || {},
      })
    },
    getLanguage() {
      return getPreferredHostEditorStateSnapshot().lang || 'zh'
    },
    saveLanguage(lang) {
      if (!canWriteBackToHost()) return
      getHostBridge()?.saveLanguage?.(lang)
      emitHostFeedback('save_success', {
        source: 'save_language',
        throttleKey: 'save_language',
        throttleMs: 220,
      })
      updatePendingEditorStateBaseline({
        lang: lang || 'zh',
      })
    },
    getLocalConfig() {
      return cloneValue(getPreferredHostEditorStateSnapshot().editor_local_config) || {}
    },
    saveLocalConfig(config) {
      if (!canWriteBackToHost()) return
      getHostBridge()?.saveLocalConfig?.(cloneValue(config))
      emitHostFeedback('save_success', {
        source: 'save_local_config',
        throttleKey: 'save_local_config',
        throttleMs: 220,
      })
      updatePendingEditorStateBaseline({
        editor_local_config: cloneValue(config) || {},
      })
    },
  }
}

function registerBusListeners() {
  if (!window.$bus) return
  if (window.__memoryAnkiBusListenersRegistered) return
  window.__memoryAnkiBusListenersRegistered = true
  window.$bus.$on('app_inited', mindMap => {
    window.__memoryAnkiMindMapInstance = mindMap
    ensureMindMapShortcutGuard()
    registerKeyboardListeners()
    registerSelectionDragListeners()
    registerPointerIntentListener()
    registerFeedbackInputListeners()
    registerContextMenuListener()
    registerReadonlyClickListener()
    registerReadonlyHoverListener()
    registerEditableDoubleClickListener()
    registerFullscreenListener()
    registerBilinkListeners()
    registerNativeFullscreenButtonStateSync()
    ensureAiSplitToolbarObserver()
    applyHostState(window.__memoryAnkiHostState || {})
    if (window.__memoryAnkiPendingEditorState) {
      const pendingFingerprint =
        window.__memoryAnkiPendingEditorState.fingerprint ||
        buildEditorStateFingerprint(
          window.__memoryAnkiPendingEditorState.editorState,
          window.__memoryAnkiPendingEditorState.preserveView,
        )
      if (
        pendingFingerprint !== window.__memoryAnkiBootstrapEditorFingerprint ||
        window.__memoryAnkiPendingEditorState.viewPolicy === 'reset'
      ) {
        syncHostEditorState(window.__memoryAnkiPendingEditorState)
      } else {
        markLastAppliedEditorFingerprint(pendingFingerprint, 'full')
        markInitialHydrationComplete(pendingFingerprint)
      }
    }
    syncKeyboardMode()
    applyUnifiedMindMapAppearance()
    updateKeyboardFocusClass()
    applySegmentNodeStyles()
    applyMiniPalaceNodeStyles()
    updateNavigatorFullscreenPresentation()
    renderBilinkBadges()
    scheduleMindMapResizeSync()
    getHostBridge()?.notify?.('app_inited', null)
  })
  window.$bus.$on('node_active', (...args) => {
    if (isReadonlyHost()) return
    markHostInteraction()
    const activeNodes = Array.isArray(args[1]) ? args[1] : []
    const activeFeedbackUid = getNodeUid(activeNodes[0] || null)
    if (activeFeedbackUid) {
      const shouldEmitNodeSelectFeedback =
        !focusState.committedNodeUid ||
        activeFeedbackUid === interactionState.pointerDownNodeUid ||
        activeFeedbackUid === focusState.committedNodeUid ||
        activeFeedbackUid === focusState.editingNodeUid
      if (shouldEmitNodeSelectFeedback) {
        emitHostFeedback('node_select', {
          source: 'node_active',
          nodeUid: activeFeedbackUid,
          throttleKey: `node_select:${activeFeedbackUid}`,
          throttleMs: 90,
        })
        emitFeedbackFx({
          type: 'node_select',
          nodeUid: activeFeedbackUid,
          relatedNodeUids: [activeFeedbackUid],
          intensity: 'soft',
          lineMode: 'trace',
          nonce: Date.now(),
        })
      }
    }
    syncKeyboardMode()
    if (activeNodes.length > 1) {
      const preferredNode =
        (interactionState.pointerDownNodeUid
          ? activeNodes.find(node => getNodeUid(node) === interactionState.pointerDownNodeUid)
          : null) ||
        activeNodes.find(node => getNodeUid(node) === focusState.committedNodeUid) ||
        activeNodes[activeNodes.length - 1] ||
        activeNodes[0] ||
        null
      if (preferredNode) {
        rememberFocusedNode(preferredNode, {
          notify: false,
          clearEditingLock: true,
          commit: !interactionState.pointerDownWithModifier,
          visual: true,
        })
      } else {
        updateKeyboardFocusClass()
      }
      getHostBridge()?.notify?.('node_active', serializeNodes(activeNodes))
      interactionState.pointerDownNodeUid = null
      interactionState.pointerDownWithModifier = false
      return
    }
    const activeNode = activeNodes[0] || null
    const activeUid = getNodeUid(activeNode)

    if (!activeUid) {
      restoreStableFocusAfterRender()
      return
    }

    if (focusState.editingNodeUid) {
      if (activeUid !== focusState.editingNodeUid) {
        restoreStableFocusAfterRender()
        return
      }
      focusState.visualFocusNodeUid = activeUid
      updateKeyboardFocusClass()
      return
    }

    if (!focusState.committedNodeUid) {
      rememberFocusedNode(activeNode, {
        notify: false,
      })
      getHostBridge()?.notify?.('node_active', serializeNodes(activeNodes))
      interactionState.pointerDownNodeUid = null
      interactionState.pointerDownWithModifier = false
      return
    }

    if (
      interactionState.pointerDownNodeUid &&
      activeUid === interactionState.pointerDownNodeUid
    ) {
      rememberFocusedNode(activeNode, {
        notify: false,
        clearEditingLock: true,
        commit: !interactionState.pointerDownWithModifier,
        visual: true,
      })
      getHostBridge()?.notify?.('node_active', serializeNodes(activeNodes))
      interactionState.pointerDownNodeUid = null
      interactionState.pointerDownWithModifier = false
      return
    }

    if (activeUid === focusState.committedNodeUid) {
      focusState.visualFocusNodeUid = activeUid
      updateKeyboardFocusClass()
      getHostBridge()?.notify?.('node_active', serializeNodes(activeNodes))
      interactionState.pointerDownNodeUid = null
      interactionState.pointerDownWithModifier = false
      return
    }

    restoreStableFocusAfterRender()
  })
  window.$bus.$on('node_click', (...args) => {
    markHostInteraction()
    const clickedNode = args[0]
    if (!clickedNode) return
    const clickedNodes = Array.isArray(args[1]) && args[1].length > 0 ? args[1] : [clickedNode]
    const clickedUid = getNodeUid(clickedNode)
    if (clickedUid && !isReadonlyPracticeMode()) {
      emitHostFeedback('pointer_click', {
        source: 'node_click',
        nodeUid: clickedUid,
        throttleKey: `node_click:${clickedUid}`,
        throttleMs: 50,
      })
      emitFeedbackFx({
        type: 'pointer_click',
        nodeUid: clickedUid,
        relatedNodeUids: [clickedUid],
        intensity: 'soft',
        lineMode: 'trace',
        nonce: Date.now(),
      })
    }
    if (isReadonlyHost()) {
      rememberFocusedNode(clickedNode, {
        notify: false,
        clearEditingLock: true,
        commit: !interactionState.pointerDownWithModifier,
        visual: true,
      })
      notifyHostNodeClick(serializeNodes(clickedNodes), { source: 'bus' })
      interactionState.pointerDownNodeUid = null
      interactionState.pointerDownWithModifier = false
      return
    }
    syncKeyboardMode()
    if (clickedNodes.length <= 1 && !interactionState.pointerDownWithModifier) {
      rememberFocusedNode(clickedNode, {
        notify: false,
        clearEditingLock: true,
      })
    } else if (interactionState.pointerDownWithModifier) {
      focusState.visualFocusNodeUid =
        getNodeUid(clickedNode) || focusState.visualFocusNodeUid
      focusState.editingNodeUid = null
      updateKeyboardFocusClass()
    }
    notifyHostNodeClick(serializeNodes(clickedNodes))
    interactionState.pointerDownNodeUid = null
    interactionState.pointerDownWithModifier = false
  })
  window.$bus.$on('node_tree_render_end', () => {
    const mindMap = window.__memoryAnkiMindMapInstance
    const pendingTransform = window.__memoryAnkiPendingTransformRestore
    if (
      pendingTransform &&
      mindMap &&
      mindMap.view &&
      typeof mindMap.view.setTransformData === 'function'
    ) {
      try {
        mindMap.view.setTransformData(cloneValue(pendingTransform))
      } catch (error) {
        console.warn(error)
      }
      window.__memoryAnkiPendingTransformRestore = null
    }
    if (
      syncState.pendingViewFitAfterRender &&
      mindMap &&
      mindMap.view &&
      typeof mindMap.view.fit === 'function'
    ) {
      syncState.pendingViewFitAfterRender = false
      try {
        mindMap.view.fit()
      } catch (error) {
        console.warn(error)
      }
    }
    if (selectionDragHistoryState.pendingFocusSnapshot) {
      restoreSelectionDragFocusSnapshot(selectionDragHistoryState.pendingFocusSnapshot)
      selectionDragHistoryState.pendingFocusSnapshot = null
    }
    restorePendingViewMemoryFocusIfNeeded()
    restorePendingSyncFocusIfNeeded()
    restorePendingFocusRequestIfNeeded()
    finalizePendingSelectionDragCreation({ rendered: true })
    restoreStableFocusAfterRender()
    markPaperLayoutReflowComplete()
    applyUnifiedMindMapAppearance()
    updateKeyboardFocusClass()
    applySegmentNodeStyles()
    applyMiniPalaceNodeStyles()
    updateNavigatorFullscreenPresentation()
    renderBilinkBadges()
    maybeFlushSoftSyncOnIdle()
    getHostBridge()?.notify?.('node_tree_render_end', null)
  })
}

function bootMindMapHost() {
  if (window.__memoryAnkiHostBooted) return
  window.__memoryAnkiHostBooted = true
  setupTakeOverMethods()
  registerBusListeners()
  if (typeof window.initApp === 'function') {
    window.initApp()
  }
}
