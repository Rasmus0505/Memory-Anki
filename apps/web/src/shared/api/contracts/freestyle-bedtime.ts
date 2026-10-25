/** 睡前复习 API payloads, split out to keep `freestyle.ts` within budget. */

import type {
  FreestyleReviewUnitCard,
  FreestyleRoundStatePayload,
} from './freestyle'

export interface FreestyleBedtimeCandidatesResponse {
  round_id: string
  count: number
  cards: FreestyleReviewUnitCard[]
}

export interface FreestyleBedtimeAppendResponse {
  round: FreestyleRoundStatePayload
  cards: FreestyleReviewUnitCard[]
  added_card_ids: string[]
}
