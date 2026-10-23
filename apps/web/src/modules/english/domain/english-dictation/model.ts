/**
 * Pure sentence-spelling state for the English dictation stage.
 *
 * Framework-free on purpose: the page only renders this model and forwards
 * keyboard input. Whole-word judgment keeps per-letter colours meaningful while
 * an unfinished word never blocks the active row.
 */

export type DictationWordStatus = 'pending' | 'active' | 'correct' | 'wrong'

export interface DictationLetter {
  char: string
  hinted: boolean
}

export interface DictationWord {
  lead: string
  answer: string
  trail: string
  chars: DictationLetter[]
  status: DictationWordStatus
}

export interface DictationSentenceSession {
  sentenceIndex: number
  words: DictationWord[]
  activeWordIndex: number
  completed: boolean
  usedHint: boolean
}

export type DictationOutcome =
  | 'ignored'
  | 'typing'
  | 'word-correct'
  | 'word-wrong'
  | 'complete'

export interface DictationStep {
  session: DictationSentenceSession
  outcome: DictationOutcome
  wordIndex: number
}

export type LetterState = 'correct' | 'wrong' | 'hinted' | 'empty' | 'caret'

const TOKEN_PATTERN = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’\-_.]*)([^\p{L}\p{N}]*)$/u
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

const DASHES_RE = /[—–−‐‑]/g

function normalizeComparableChar(char: string) {
  return char.replace('’', "'").replace(DASHES_RE, '-').toLowerCase()
}

function normalizeToken(token: string) {
  return token.trim().replace(/’/g, "'").replace(DASHES_RE, '-').toLowerCase()
}

export function splitDisplayTokens(text: string): Array<{ lead: string; answer: string; trail: string }> {
  const source = String(text || '').trim()
  if (!source) return []
  const output: Array<{ lead: string; answer: string; trail: string }> = []
  let pendingLead = ''
  for (const raw of source.split(/\s+/)) {
    if (!raw) continue
    const match = TOKEN_PATTERN.exec(raw)
    if (match) {
      output.push({ lead: pendingLead + match[1], answer: match[2], trail: match[3] })
      pendingLead = ''
      continue
    }
    if (!LETTER_OR_DIGIT.test(raw)) {
      pendingLead += raw
      continue
    }
    output.push({ lead: pendingLead, answer: raw, trail: '' })
    pendingLead = ''
  }
  if (pendingLead) {
    if (output.length > 0) output[output.length - 1].trail += pendingLead
    else output.push({ lead: pendingLead, answer: '', trail: '' })
  }
  return output
}

/**
 * Build words from the display sentence when it agrees with the normalized
 * token list. Otherwise (e.g. "$5" → "five dollars") the token list is the
 * spellable source of truth and punctuation is trimmed away.
 */
export function buildDictationWords(textEn: string, tokens?: string[] | null): DictationWord[] {
  const display = splitDisplayTokens(textEn)
  const expectedTokens = (tokens || []).map(normalizeToken).filter(Boolean)
  const displayComparable = display.map((token) => normalizeToken(token.answer))
  const displayMatches =
    expectedTokens.length > 0 &&
    displayComparable.length === expectedTokens.length &&
    displayComparable.every((value, index) => value === expectedTokens[index])

  if (display.length > 0 && (expectedTokens.length === 0 || displayMatches)) {
    return display.map((token) => ({
      lead: token.lead,
      answer: token.answer,
      trail: token.trail,
      chars: [],
      status: 'pending',
    }))
  }

  const finalTrail = String(textEn || '').match(/[.!?…]+["'”’)\]]*$/)?.[0] || ''
  return expectedTokens.map((token, index) => ({
    lead: '',
    answer: token,
    trail: index === expectedTokens.length - 1 ? finalTrail : '',
    chars: [],
    status: 'pending',
  }))
}

export function createDictationSession(
  sentenceIndex: number,
  textEn: string,
  tokens?: string[] | null,
): DictationSentenceSession {
  const words = buildDictationWords(textEn, tokens)
  if (words.length > 0) words[0].status = 'active'
  return {
    sentenceIndex,
    words,
    activeWordIndex: words.length > 0 ? 0 : 0,
    completed: words.length === 0,
    usedHint: false,
  }
}

export function currentDictationWord(session: DictationSentenceSession): DictationWord | null {
  return session.words[session.activeWordIndex] || null
}

function cloneWord(word: DictationWord): DictationWord {
  return {
    lead: word.lead,
    answer: word.answer,
    trail: word.trail,
    chars: word.chars.map((char) => ({ ...char })),
    status: word.status,
  }
}

function cloneSession(session: DictationSentenceSession): DictationSentenceSession {
  return {
    sentenceIndex: session.sentenceIndex,
    words: session.words.map(cloneWord),
    activeWordIndex: session.activeWordIndex,
    completed: session.completed,
    usedHint: session.usedHint,
  }
}

function wordIsComplete(word: DictationWord) {
  return word.chars.length >= word.answer.length
}

function wordIsCorrect(word: DictationWord) {
  if (word.answer.length === 0) return false
  return (
    word.chars.length === word.answer.length &&
    word.chars.every(
      (char, index) => normalizeComparableChar(char.char) === normalizeComparableChar(word.answer[index]),
    )
  )
}

function settleWord(
  session: DictationSentenceSession,
  wordIndex: number,
  correct: boolean,
): DictationStep {
  const word = session.words[wordIndex]
  if (!word) return { session, outcome: 'ignored', wordIndex }
  word.status = correct ? 'correct' : 'wrong'
  if (!correct) {
    return { session, outcome: 'word-wrong', wordIndex }
  }
  const nextIndex = wordIndex + 1
  if (nextIndex >= session.words.length) {
    session.activeWordIndex = session.words.length
    session.completed = true
    return { session, outcome: 'complete', wordIndex }
  }
  session.activeWordIndex = nextIndex
  if (session.words[nextIndex].status === 'pending') {
    session.words[nextIndex].status = 'active'
  }
  return { session, outcome: 'word-correct', wordIndex }
}

export function typeDictationChar(
  session: DictationSentenceSession,
  rawChar: string,
): DictationStep {
  if (session.completed || !rawChar) {
    return { session, outcome: 'ignored', wordIndex: session.activeWordIndex }
  }
  const wordIndex = session.activeWordIndex
  const word = session.words[wordIndex]
  if (!word || word.status === 'wrong' || wordIsComplete(word)) {
    return { session, outcome: 'ignored', wordIndex }
  }
  const next = cloneSession(session)
  const target = next.words[wordIndex]
  if (target.chars.length >= target.answer.length) {
    return { session, outcome: 'ignored', wordIndex }
  }
  target.chars.push({ char: rawChar.slice(0, 1), hinted: false })
  if (!wordIsComplete(target)) {
    return { session: next, outcome: 'typing', wordIndex }
  }
  return settleWord(next, wordIndex, wordIsCorrect(target))
}

export function backspaceDictationChar(session: DictationSentenceSession): DictationSentenceSession {
  if (session.completed) return session
  const wordIndex = session.activeWordIndex
  const word = session.words[wordIndex]
  if (!word || word.status !== 'active' || word.chars.length === 0) return session
  const next = cloneSession(session)
  const target = next.words[wordIndex]
  target.chars.pop()
  return next
}

export function clearWrongDictationWord(
  session: DictationSentenceSession,
  wordIndex: number,
): DictationSentenceSession {
  const word = session.words[wordIndex]
  if (!word || word.status !== 'wrong') return session
  const next = cloneSession(session)
  const target = next.words[wordIndex]
  if (target.status !== 'wrong') return session
  target.chars = []
  target.status = next.activeWordIndex === wordIndex ? 'active' : 'pending'
  return next
}

export function completeDictationWordFail(
  session: DictationSentenceSession,
  wordIndex = session.activeWordIndex,
): DictationStep {
  const word = session.words[wordIndex]
  if (!word || word.status === 'correct') {
    return { session, outcome: 'ignored', wordIndex }
  }
  const next = cloneSession(session)
  return settleWord(next, wordIndex, false)
}

export function revealDictationLetter(session: DictationSentenceSession): DictationStep {
  if (session.completed) return { session, outcome: 'ignored', wordIndex: session.activeWordIndex }
  const wordIndex = session.activeWordIndex
  const word = session.words[wordIndex]
  if (!word || word.status === 'wrong' || wordIsComplete(word)) {
    return { session, outcome: 'ignored', wordIndex }
  }
  const next = cloneSession(session)
  const target = next.words[wordIndex]
  const answerIndex = target.chars.length
  const answerChar = target.answer[answerIndex]
  if (answerChar == null) return { session, outcome: 'ignored', wordIndex }
  target.chars.push({ char: answerChar, hinted: true })
  next.usedHint = true
  if (!wordIsComplete(target)) {
    return { session: next, outcome: 'typing', wordIndex }
  }
  return settleWord(next, wordIndex, wordIsCorrect(target))
}

export function revealDictationWord(session: DictationSentenceSession): DictationStep {
  if (session.completed) return { session, outcome: 'ignored', wordIndex: session.activeWordIndex }
  const wordIndex = session.activeWordIndex
  const word = session.words[wordIndex]
  if (!word || word.status === 'wrong') {
    return { session, outcome: 'ignored', wordIndex }
  }
  const next = cloneSession(session)
  const target = next.words[wordIndex]
  target.chars = Array.from(target.answer).map((char) => ({ char, hinted: true }))
  next.usedHint = true
  return settleWord(next, wordIndex, true)
}

export function revealWholeDictationSession(session: DictationSentenceSession): DictationSentenceSession {
  const next = cloneSession(session)
  for (const word of next.words) {
    word.chars = Array.from(word.answer).map((char) => ({ char, hinted: true }))
    word.status = 'correct'
  }
  next.activeWordIndex = next.words.length
  next.completed = next.words.length > 0
  next.usedHint = true
  return next
}

export function resetDictationSession(session: DictationSentenceSession): DictationSentenceSession {
  const next = cloneSession(session)
  for (const word of next.words) {
    word.chars = []
    word.status = 'pending'
  }
  if (next.words.length > 0) next.words[0].status = 'active'
  next.activeWordIndex = 0
  next.completed = next.words.length === 0
  next.usedHint = false
  return next
}

export function markDictationSessionSolved(session: DictationSentenceSession): DictationSentenceSession {
  return revealWholeDictationSession(session)
}

export function buildDictationInputText(session: DictationSentenceSession): string {
  return session.words
    .map((word) => word.answer)
    .filter(Boolean)
    .join(' ')
}

export function getLetterState(
  word: DictationWord,
  index: number,
  isActive: boolean,
): LetterState {
  const typed = word.chars[index]
  if (typed) {
    if (typed.hinted) return 'hinted'
    const expected = word.answer[index] || ''
    return normalizeComparableChar(typed.char) === normalizeComparableChar(expected)
      ? 'correct'
      : 'wrong'
  }
  if (isActive && word.status === 'active' && index === word.chars.length) return 'caret'
  return 'empty'
}

export function getWordVisualStatus(
  word: DictationWord,
  index: number,
  session: DictationSentenceSession,
): DictationWordStatus {
  if (word.status === 'wrong') return 'wrong'
  if (word.status === 'correct') return 'correct'
  if (!session.completed && index === session.activeWordIndex) return 'active'
  return word.status
}

export interface DictationCounts {
  totalWords: number
  correctWords: number
  totalLetters: number
  typedLetters: number
  hintedLetters: number
  errorLetters: number
}

export function countDictationProgress(session: DictationSentenceSession): DictationCounts {
  let correctWords = 0
  let totalLetters = 0
  let typedLetters = 0
  let hintedLetters = 0
  let errorLetters = 0
  for (const word of session.words) {
    totalLetters += word.answer.length
    typedLetters += word.chars.length
    if (word.status === 'correct') correctWords += 1
    word.chars.forEach((char, index) => {
      if (char.hinted) {
        hintedLetters += 1
        return
      }
      const expected = word.answer[index] || ''
      if (normalizeComparableChar(char.char) !== normalizeComparableChar(expected)) errorLetters += 1
    })
  }
  return {
    totalWords: session.words.length,
    correctWords,
    totalLetters,
    typedLetters,
    hintedLetters,
    errorLetters,
  }
}
