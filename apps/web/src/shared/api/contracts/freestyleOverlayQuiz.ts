/** 打乱题库 request, split out to keep `freestyle.ts` within budget. */
export interface FreestyleOverlayQuizShuffleRequest {
  operation_id: string
  expected_version: number
}
