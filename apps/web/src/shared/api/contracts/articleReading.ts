export type ArticleReadingOwnerId = `palace:${number}` | `knowledge-subject:${number}`

export interface ArticleReadingWrite {
  node_uid: string
  block_offset?: number | null
  client_id: string
  operation_id: string
  client_sequence: number
  expected_revision: number
}

export interface ArticleReadingCursor {
  owner_id: ArticleReadingOwnerId
  node_uid: string
  block_offset: number | null
  updated_at: string
  client_id: string
  operation_id: string
  client_sequence: number
  revision: number
}

export interface ArticleReadingResponse {
  owner_id: ArticleReadingOwnerId
  cursor: ArticleReadingCursor | null
}
