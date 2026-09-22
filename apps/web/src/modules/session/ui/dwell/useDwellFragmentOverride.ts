import { useEffect, useRef } from 'react'
import {
  popDwellFragmentOverride,
  pushDwellFragmentOverride,
  updateDwellFragmentOverride,
} from '@/modules/session/domain/session-entity/model/timed-session/dwellFragmentOverride'
import type { DwellFragmentOverride } from '@/modules/session/domain/session-entity/model/timed-session/dwellPolicy'

/**
 * Report the topmost open overlay as the current dwell fragment.
 * Register only while `active` flips; field changes update that entry in place
 * so a nested 查看宫殿 is not covered when the quiz palace changes.
 */
export function useDwellFragmentOverride(active: boolean, override: DwellFragmentOverride) {
  const idRef = useRef<number | null>(null)
  const overrideRef = useRef(override)
  overrideRef.current = override

  useEffect(() => {
    if (!active) return
    const id = pushDwellFragmentOverride(overrideRef.current)
    idRef.current = id
    return () => {
      popDwellFragmentOverride(id)
      if (idRef.current === id) idRef.current = null
    }
  }, [active])

  useEffect(() => {
    if (!active || idRef.current == null) return
    updateDwellFragmentOverride(idRef.current, {
      scene: override.scene,
      kind: override.kind,
      title: override.title,
      palaceId: override.palaceId,
      sourceKind: override.sourceKind,
      priority: override.priority,
    })
  }, [
    active,
    override.kind,
    override.palaceId,
    override.priority,
    override.scene,
    override.sourceKind,
    override.title,
  ])
}
