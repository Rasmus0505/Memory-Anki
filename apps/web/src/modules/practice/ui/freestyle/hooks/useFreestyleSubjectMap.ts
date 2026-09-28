import { useEffect, useState } from 'react'
import { getPalacesGroupedApi } from '@/modules/content/public'
import { flattenPalaceOptions } from '@/modules/practice/ui/freestyle/model/freestyle-cards'

export function useFreestyleSubjectMap() {
  const [subjectByPalaceId, setSubjectByPalaceId] = useState<
    ReadonlyMap<number, { id: number; name: string }>
  >(() => new Map())

  useEffect(() => {
    let active = true
    void getPalacesGroupedApi().then((value) => {
      if (!active) return
      const map = new Map<number, { id: number; name: string }>()
      for (const palace of flattenPalaceOptions(value)) {
        const subject = palace.subject
        if (!subject?.id || !subject.name) continue
        map.set(palace.id, { id: subject.id, name: subject.name })
      }
      setSubjectByPalaceId(map)
    }).catch(() => {
      if (active) setSubjectByPalaceId(new Map())
    })
    return () => { active = false }
  }, [])

  return subjectByPalaceId
}
