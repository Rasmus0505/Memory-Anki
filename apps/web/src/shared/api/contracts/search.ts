export interface SearchPalaceHit {
  id: number
  title: string
  snippet: string
}

export interface SearchPegHit {
  id: number
  palace_id: number
  palace_title: string
  name: string
  snippet: string
}

export interface SearchQuestionHit {
  id: number
  palace_id: number | null
  palace_title: string
  snippet: string
}

export interface SearchChapterHit {
  id: number
  name: string
  subject_name: string
}

export interface GlobalSearchResponse {
  query: string
  palaces: SearchPalaceHit[]
  pegs: SearchPegHit[]
  questions: SearchQuestionHit[]
  chapters: SearchChapterHit[]
}
