export type ClozeChoice = 'A' | 'B' | 'C' | 'D'

export interface ClozeOption {
  key: ClozeChoice
  text: string
}

export interface ClozeBlank {
  n: number
  answer: ClozeChoice
  options: ClozeOption[]
}

export interface ClozeYear {
  year: number
  paragraphs: string[]
  blanks: ClozeBlank[]
}

export interface ClozeCorpus {
  schema: 'english-ii-cloze.v1'
  years: ClozeYear[]
}

export interface ClozeMarks {
  marked: string[]
  dismissed: string[]
}

export type ClozeToken =
  | { kind: 'word'; text: string; key: string }
  | { kind: 'blank'; text: string; key: string; n: number }
  | { kind: 'gap'; text: string }

const BLANK_PATTERN = /__(\d+)__/g
const WORD_PATTERN = /[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z]+/g

const EASY_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'from', 'as', 'at',
  'into', 'over', 'after', 'before', 'while', 'when', 'if', 'though', 'because',
  'and', 'or', 'but', 'nor', 'not', 'no', 'never', 'ever', 'even', 'still', 'yet',
  'only', 'also', 'than', 'then', 'that', 'this', 'these', 'those', 'it', 'its',
  'his', 'her', 'their', 'they', 'them', 'we', 'you', 'he', 'she', 'who', 'which',
  'what', 'there', 'here', 'been', 'being', 'have', 'has', 'had', 'was', 'were',
  'are', 'is', 'be', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'may',
  'might', 'should', 'must', 'up', 'out', 'off', 'down', 'about', 'against',
  'among', 'between', 'through', 'during', 'without', 'within', 'across', 'around',
  'under', 'above', 'such', 'more', 'most', 'other', 'some', 'any', 'all', 'each',
  'both', 'few', 'many', 'much', 'very', 'just', 'like', 'well', 'back', 'so',
  'too', 'own', 'same', 'new', 'old', 'good', 'first', 'one', 'two', 'three',
  'however', 'therefore', 'moreover', 'instead', 'likewise', 'otherwise', 'until',
  'since', 'unless', 'where', 'why', 'how', 'so', 'thus', 'also', 'often', 'always',
  'people', 'person', 'man', 'woman', 'child', 'children', 'year', 'years', 'time',
  'day', 'way', 'world', 'life', 'work', 'make', 'made', 'take', 'took', 'come',
  'came', 'go', 'went', 'see', 'know', 'think', 'say', 'said', 'get', 'got',
  'give', 'use', 'used', 'using', 'new', 'high', 'low', 'large', 'small', 'long',
  'great', 'important', 'different', 'same', 'public', 'private', 'national',
  'government', 'company', 'companies', 'system', 'systems', 'research', 'study',
  'studies', 'health', 'money', 'problem', 'problems', 'result', 'results',
  'change', 'increase', 'part', 'number', 'group', 'groups', 'state', 'states',
  'country', 'countries', 'city', 'home', 'school', 'family', 'friend', 'job',
  'business', 'market', 'price', 'cost', 'plan', 'idea', 'fact', 'case', 'point',
  'example', 'information', 'service', 'services', 'social', 'human', 'young',
  'early', 'late', 'next', 'last', 'best', 'better', 'able', 'need', 'needs',
  'want', 'help', 'keep', 'put', 'set', 'end', 'start', 'begin', 'show', 'find',
  'found', 'leave', 'left', 'call', 'ask', 'feel', 'seem', 'become', 'look',
  'according', 'including', 'already', 'still', 'another', 'others', 'own',
])

export const EMPTY_CLOZE_MARKS: ClozeMarks = { marked: [], dismissed: [] }

export function vocabKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function isEasyWord(key: string): boolean {
  return EASY_WORDS.has(vocabKey(key))
}

export function blankAnswerText(blank: ClozeBlank): string {
  return blank.options.find((option) => option.key === blank.answer)?.text ?? `__${blank.n}__`
}

export function tokenizeParagraph(paragraph: string, blanks: ClozeBlank[]): ClozeToken[] {
  const byNumber = new Map(blanks.map((blank) => [blank.n, blank]))
  const tokens: ClozeToken[] = []
  let last = 0
  for (const match of paragraph.matchAll(BLANK_PATTERN)) {
    const index = match.index ?? 0
    if (index > last) tokens.push(...tokenizePlain(paragraph.slice(last, index)))
    const n = Number(match[1])
    const blank = byNumber.get(n)
    const text = blank ? blankAnswerText(blank) : match[0]
    tokens.push({ kind: 'blank', text, key: vocabKey(text), n })
    last = index + match[0].length
  }
  if (last < paragraph.length) tokens.push(...tokenizePlain(paragraph.slice(last)))
  return tokens
}

function tokenizePlain(text: string): ClozeToken[] {
  const tokens: ClozeToken[] = []
  for (const match of text.matchAll(WORD_PATTERN)) {
    const part = match[0]
    if (/[A-Za-z]/.test(part)) {
      tokens.push({ kind: 'word', text: part, key: vocabKey(part) })
    } else if (part.length > 0) {
      tokens.push({ kind: 'gap', text: part })
    }
  }
  return tokens
}

export function filledParagraph(paragraph: string, blanks: ClozeBlank[]): string {
  return tokenizeParagraph(paragraph, blanks).map((token) => token.text).join('')
}

export function articleCopyText(year: ClozeYear): string {
  const body = year.paragraphs
    .map((paragraph) => filledParagraph(paragraph, year.blanks))
    .join('\n\n')
  return `${year.year}年考研英语（二）完形\n\n${body}`
}

export function optionsCopyText(year: ClozeYear): string {
  const lines = year.blanks.map((blank) => {
    const choices = blank.options.map((option) => `${option.key}. ${option.text}`).join('   ')
    return `${blank.n}. ${choices}  → ${blank.answer}`
  })
  return `${year.year}年完形选项\n\n${lines.join('\n')}`
}

const STATIC_HARD = [
  'epidemic', 'heightened', 'severity', 'overwhelming', 'hospitalization',
  'anonymity', 'credential', 'authenticate', 'skepticism', 'vulnerable',
  'compulsory', 'obesity', 'stereotype', 'correlation', 'inequality',
  'plausible', 'sentiment', 'inclination', 'desirable', 'contemporary',
  'unbearable', 'inherently', 'acquaintance', 'acquaintances', 'uneasiness',
  'disruptive', 'misinterpreted', 'unfamiliar', 'anxious', 'headquartered',
  'punctuality', 'sacrifice', 'criterion', 'criteria', 'multidimensional',
  'entrepreneur', 'entrepreneurs', 'plateaued', 'interdisciplinary',
  'skyrocketed', 'bimonthly', 'fluctuation', 'fluctuations', 'obsessing',
  'indispensable', 'productively', 'self-destructive', 'consequences',
]

export function optionHardKeys(years: ClozeYear[]): Set<string> {
  const keys = new Set<string>()
  for (const year of years) {
    for (const blank of year.blanks) {
      for (const option of blank.options) {
        const phrase = vocabKey(option.text)
        if (!phrase || isEasyWord(phrase)) continue
        keys.add(phrase)
        if (phrase.includes(' ')) {
          for (const word of phrase.split(' ')) {
            if (word.length >= 5 && !isEasyWord(word)) keys.add(word)
          }
        }
      }
    }
  }
  return keys
}

export function buildHardKeys(years: ClozeYear[]): Set<string> {
  const keys = optionHardKeys(years)
  for (const word of STATIC_HARD) {
    if (!isEasyWord(word)) keys.add(word)
  }
  return keys
}

export function isSuggestedKey(key: string, hardKeys: ReadonlySet<string>, marks: ClozeMarks): boolean {
  const normalized = vocabKey(key)
  if (!normalized || isEasyWord(normalized) || marks.dismissed.includes(normalized) || marks.marked.includes(normalized)) {
    return false
  }
  if (hardKeys.has(normalized)) return true
  const stem = lightStem(normalized)
  return stem !== normalized && hardKeys.has(stem)
}

export function isUserMarked(key: string, marks: ClozeMarks): boolean {
  return marks.marked.includes(vocabKey(key))
}

export function isVocabWord(key: string, hardKeys: ReadonlySet<string>, marks: ClozeMarks): boolean {
  return isUserMarked(key, marks) || isSuggestedKey(key, hardKeys, marks)
}

export function toggleVocabWord(key: string, hardKeys: ReadonlySet<string>, marks: ClozeMarks): ClozeMarks {
  const normalized = vocabKey(key)
  if (!normalized) return marks
  const marked = new Set(marks.marked)
  const dismissed = new Set(marks.dismissed)
  if (isVocabWord(normalized, hardKeys, marks)) {
    marked.delete(normalized)
    dismissed.add(normalized)
  } else {
    dismissed.delete(normalized)
    marked.add(normalized)
  }
  return {
    marked: [...marked].sort(),
    dismissed: [...dismissed].sort(),
  }
}

export function vocabCopyText(keys: Iterable<string>): string {
  return [...new Set([...keys].map(vocabKey).filter(Boolean))].sort().join('\n')
}

export function collectVocabKeys(
  years: ClozeYear[],
  hardKeys: ReadonlySet<string>,
  marks: ClozeMarks,
): string[] {
  const found = new Set<string>()
  for (const year of years) {
    for (const paragraph of year.paragraphs) {
      for (const token of tokenizeParagraph(paragraph, year.blanks)) {
        if (token.kind === 'gap') continue
        if (isVocabWord(token.key, hardKeys, marks)) found.add(token.key)
      }
    }
  }
  return [...found].sort()
}

function lightStem(key: string): string {
  if (key.endsWith('ies') && key.length > 5) return `${key.slice(0, -3)}y`
  if (key.endsWith('ing') && key.length > 6) return key.slice(0, -3)
  if (key.endsWith('ed') && key.length > 5) return key.slice(0, -2)
  if (key.endsWith('es') && key.length > 5) return key.slice(0, -2)
  if (key.endsWith('s') && key.length > 4 && !key.endsWith('ss')) return key.slice(0, -1)
  return key
}
