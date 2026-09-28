import { clampStars } from '../model/examFormat'

export function ExamStarBadge({ stars, className = '' }: { stars: number; className?: string }) {
  const value = clampStars(stars)
  return (
    <span className={`exam-star-badge ${className}`} aria-label={`考试重要度 ${value} 星`} role="img">
      {[1, 2, 3].map((index) => (
        <span key={index} aria-hidden="true" data-off={index > value}>
          ★
        </span>
      ))}
    </span>
  )
}
