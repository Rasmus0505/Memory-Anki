import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/api/client'

export interface MindMapSelection {
  uid: string | null
  text: string
  note: string
  memoryAnkiId: number | null
  memoryAnkiNodeType: string | null
  rawData: Record<string, unknown>
}

interface MindMapFrameProps {
  editorState: MindMapEditorState
  readonly?: boolean
  showToolbarWhenReadonly?: boolean
  syncOnPropChange?: boolean
  preserveViewOnSync?: boolean
  className?: string
  onEditorStateChange: (nextState: MindMapEditorState) => void
  onNodeActive?: (nodes: MindMapSelection[]) => void
  onNodeClick?: (nodes: MindMapSelection[]) => void
  onNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onReady?: () => void
}

interface HostBridge {
  getMindMapData: () => Record<string, unknown>
  saveMindMapData: (data: Record<string, unknown>) => void
  getMindMapConfig: () => Record<string, unknown>
  saveMindMapConfig: (config: Record<string, unknown>) => void
  getLanguage: () => string
  saveLanguage: (lang: string) => void
  getLocalConfig: () => Record<string, unknown>
  saveLocalConfig: (config: Record<string, unknown>) => void
  notify: (event: string, payload: unknown) => void
}

declare global {
  interface Window {
    __memoryAnkiMindMapHosts?: Record<string, HostBridge>
  }
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function MindMapFrame({
  editorState,
  readonly = false,
  showToolbarWhenReadonly = false,
  syncOnPropChange = false,
  preserveViewOnSync = false,
  className,
  onEditorStateChange,
  onNodeActive,
  onNodeClick,
  onNodeContextMenu,
  onReady,
}: MindMapFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const stateRef = useRef(editorState)
  const onEditorStateChangeRef = useRef(onEditorStateChange)
  const onNodeActiveRef = useRef(onNodeActive)
  const onNodeClickRef = useRef(onNodeClick)
  const onNodeContextMenuRef = useRef(onNodeContextMenu)
  const onReadyRef = useRef(onReady)
  const lastSyncedFingerprintRef = useRef('')
  const [isLoaded, setIsLoaded] = useState(false)

  stateRef.current = editorState
  onEditorStateChangeRef.current = onEditorStateChange
  onNodeActiveRef.current = onNodeActive
  onNodeClickRef.current = onNodeClick
  onNodeContextMenuRef.current = onNodeContextMenu
  onReadyRef.current = onReady

  const rawHostId = useId()
  const hostId = useMemo(() => rawHostId.replace(/[^a-zA-Z0-9_-]/g, '_'), [rawHostId])

  useEffect(() => {
    const registry = (window.__memoryAnkiMindMapHosts ??= {})
    registry[hostId] = {
      getMindMapData: () => cloneValue(stateRef.current.editor_doc),
      saveMindMapData: (data) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_doc: cloneValue(data),
        })
      },
      getMindMapConfig: () => cloneValue(stateRef.current.editor_config),
      saveMindMapConfig: (config) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_config: cloneValue(config),
        })
      },
      getLanguage: () => stateRef.current.lang || 'zh',
      saveLanguage: (lang) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          lang: lang || 'zh',
        })
      },
      getLocalConfig: () => cloneValue(stateRef.current.editor_local_config),
      saveLocalConfig: (config) => {
        onEditorStateChangeRef.current({
          ...stateRef.current,
          editor_local_config: cloneValue(config),
        })
      },
      notify: (event, payload) => {
        if (event === 'app_inited') {
          onReadyRef.current?.()
          syncHostState()
          return
        }
        if (event === 'node_active') {
          onNodeActiveRef.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
        }
        if (event === 'node_click') {
          onNodeClickRef.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
        }
        if (event === 'node_contextmenu') {
          onNodeContextMenuRef.current?.(Array.isArray(payload) ? (payload as MindMapSelection[]) : [])
        }
      },
    }

    return () => {
      if (window.__memoryAnkiMindMapHosts) {
        delete window.__memoryAnkiMindMapHosts[hostId]
      }
    }
  }, [hostId])

  const syncHostEditorState = () => {
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & {
          syncHostEditorState?: (payload: { editorState: MindMapEditorState; preserveView: boolean }) => void
        })
      | null
    iframeWindow?.syncHostEditorState?.({
      editorState: cloneValue(stateRef.current),
      preserveView: preserveViewOnSync,
    })
  }

  const syncHostState = () => {
    const iframeWindow = iframeRef.current?.contentWindow as
      | (Window & { applyHostState?: (state: { readonly: boolean; showToolbarWhenReadonly: boolean }) => void })
      | null
    iframeWindow?.applyHostState?.({ readonly, showToolbarWhenReadonly })
  }

  useEffect(() => {
    if (isLoaded) {
      syncHostState()
    }
  }, [isLoaded, readonly, showToolbarWhenReadonly])

  useEffect(() => {
    if (!syncOnPropChange || !isLoaded) return
    const fingerprint = JSON.stringify({
      editor_doc: editorState.editor_doc,
      editor_config: editorState.editor_config,
      editor_local_config: editorState.editor_local_config,
      lang: editorState.lang,
      preserveViewOnSync,
    })
    if (lastSyncedFingerprintRef.current === fingerprint) return
    lastSyncedFingerprintRef.current = fingerprint
    syncHostEditorState()
  }, [editorState, isLoaded, preserveViewOnSync, syncOnPropChange])

  return (
    <iframe
      ref={iframeRef}
      title="mind-map-editor"
      src={`/mind-map-host.html?host=${encodeURIComponent(hostId)}`}
      className={className ?? 'h-full w-full border-0'}
      onLoad={() => {
        setIsLoaded(true)
        syncHostState()
      }}
    />
  )
}
