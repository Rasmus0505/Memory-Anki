import { useRef, useState } from 'react'
import type { ExamStarSource } from '@/shared/api/contracts'
import { setChapterStarsApi, setPalaceStarsApi } from '../api/examApi'
import { clampStars, starSourceLabel } from '../model/examFormat'

interface ExamStarPickerProps {
  kind: 'palace' | 'chapter'
  entityId: number
  /** Effective stars shown when nothing is set on this entity. */
  stars: number
  source: ExamStarSource | null
  /** Stars stored on this entity itself; null means inherited/derived. */
  ownStars: number | null
  onSaved?: (next: { ownStars: number | null }) => void
}

export function ExamStarPicker({ kind, entityId, stars, source, ownStars, onSaved }: ExamStarPickerProps) {
  const [pending, setPending] = useState<number | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // One request token per entity: a late reply for an older click must not win.
  const tokenRef = useRef(0)
  const shownOwn = pending !== undefined ? pending : ownStars
  const shown = clampStars(shownOwn ?? stars)

  const save = async (next: number | null) => {
    const token = ++tokenRef.current
    setPending(next)
    setError(null)
    try {
      const api = kind === 'palace' ? setPalaceStarsApi : setChapterStarsApi
      const result = await api(entityId, next)
      if (token !== tokenRef.current) return
      onSaved?.({ ownStars: result.exam_stars })
    } catch (caught) {
      if (token !== tokenRef.current) return
      setError(caught instanceof Error ? caught.message : '保存失败')
    } finally {
      if (token === tokenRef.current) setPending(undefined)
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      <div role="radiogroup" aria-label="考试重要度" className="inline-flex">
        {[1, 2, 3].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={shown === value}
            aria-label={`${value} 星`}
            className="exam-star-badge h-6 w-5 justify-center rounded transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transition-none"
            onClick={() => void save(shownOwn === value ? null : value)}
          >
            <span data-off={value > shown} aria-hidden="true">★</span>
          </button>
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {error ?? (shownOwn != null ? '手动' : starSourceLabel(source))}
      </span>
    </div>
  )
}
