export type EnglishWordStatus = 'pending' | 'active' | 'correct' | 'wrong'

export interface EnglishWordState {
  activeWordIndex: number
  currentWordInput: string
  wordInputs: string[]
  wordStatuses: EnglishWordStatus[]
}

export interface EnglishLetterSlot {
  key: string
  char: string
  state: 'empty' | 'correct' | 'wrong' | 'revealed' | 'fixed'
  extra: boolean
}

const PUNCT_EDGE_RE = /^[\s\.,!?;:"'`~\-\(\)\[\]\{\}]+|[\s\.,!?;:"'`~\-\(\)\[\]\{\}]+$/g
const FIXED_TOKEN_CHARS = new Set(["'", '’', '-'])

export function normalizeEnglishLearningToken(token: string) {
  return String(token || '')
    .trim()
    .toLowerCase()
    .replaceAll('’', "'")
    .replace(PUNCT_EDGE_RE, '')
}

export function normalizeComparableToken(token: string) {
  return normalizeEnglishLearningToken(token).replaceAll("'", '').replaceAll('-', '')
}

export function countTokenInputErrors(inputValue: string, expectedToken: string) {
  const actual = normalizeComparableToken(inputValue)
  const expected = normalizeComparableToken(expectedToken)
  const sameLength = Math.min(actual.length, expected.length)

  let mismatchCount = 0
  for (let index = 0; index < sameLength; index += 1) {
    if (actual[index]?.toLowerCase() !== expected[index]?.toLowerCase()) {
      mismatchCount += 1
    }
  }

  if (actual.length > expected.length) {
    mismatchCount += actual.length - expected.length
  }

  return mismatchCount
}

export function buildLetterSlots(
  expectedToken: string,
  inputValue: string,
  revealedComparableIndices: number[] = [],
): EnglishLetterSlot[] {
  const expected = String(expectedToken || '')
  const actual = normalizeComparableToken(inputValue)
  const comparableExpected = normalizeComparableToken(expected)
  const revealedSet = new Set(revealedComparableIndices)
  const slots: EnglishLetterSlot[] = []
  let typedIndex = 0
  let comparableIndex = 0

  for (let index = 0; index < expected.length; index += 1) {
    const expectedChar = expected[index] || ''
    if (FIXED_TOKEN_CHARS.has(expectedChar)) {
      slots.push({
        key: `slot-fixed-${index}`,
        char: expectedChar === '’' ? "'" : expectedChar,
        state: 'fixed',
        extra: false,
      })
      continue
    }

    const typedChar = actual[typedIndex] || ''
    let state: EnglishLetterSlot['state'] = 'empty'
    if (typedChar) {
      const expectedComparableChar = comparableExpected[comparableIndex] || ''
      const matched = typedChar.toLowerCase() === expectedComparableChar.toLowerCase()
      if (matched) {
        state = revealedSet.has(comparableIndex) ? 'revealed' : 'correct'
      } else {
        state = 'wrong'
      }
      typedIndex += 1
    }

    slots.push({
      key: `slot-${index}`,
      char: typedChar || '\u00A0',
      state,
      extra: false,
    })
    comparableIndex += 1
  }

  for (let index = typedIndex; index < actual.length; index += 1) {
    slots.push({
      key: `extra-${index}`,
      char: actual[index] || '\u00A0',
      state: 'wrong',
      extra: true,
    })
  }

  if (slots.length > 0) return slots

  return [
    {
      key: 'slot-empty',
      char: '\u00A0',
      state: 'empty',
      extra: false,
    },
  ]
}

export function createWordState(tokens: string[]): EnglishWordState {
  const safeTokens = Array.isArray(tokens) ? tokens.filter((token) => typeof token === 'string' && token.trim()) : []
  return {
    activeWordIndex: 0,
    currentWordInput: '',
    wordInputs: safeTokens.map(() => ''),
    wordStatuses: safeTokens.map((_, index) => (index === 0 ? 'active' : 'pending')),
  }
}

export function cloneWordState(state: EnglishWordState): EnglishWordState {
  return {
    activeWordIndex: Math.max(0, Number(state.activeWordIndex || 0)),
    currentWordInput: String(state.currentWordInput || ''),
    wordInputs: Array.isArray(state.wordInputs) ? [...state.wordInputs] : [],
    wordStatuses: Array.isArray(state.wordStatuses) ? [...state.wordStatuses] : [],
  }
}

export function clearActiveWordInState(state: EnglishWordState): EnglishWordState {
  const next = cloneWordState(state)
  if (next.activeWordIndex >= next.wordInputs.length) return next
  next.currentWordInput = ''
  next.wordInputs[next.activeWordIndex] = ''
  next.wordStatuses[next.activeWordIndex] = 'active'
  return next
}

export function completeActiveWordInState(state: EnglishWordState, tokens: string[]) {
  const next = cloneWordState(state)
  const activeIndex = next.activeWordIndex
  if (activeIndex < 0 || activeIndex >= tokens.length) {
    return {
      state: next,
      completedSentence: activeIndex >= tokens.length,
    }
  }

  next.wordInputs[activeIndex] = String(tokens[activeIndex] || '')
  next.wordStatuses[activeIndex] = 'correct'
  next.currentWordInput = ''

  const nextIndex = activeIndex + 1
  if (nextIndex < tokens.length) {
    next.activeWordIndex = nextIndex
    next.wordStatuses[nextIndex] = 'active'
    return {
      state: next,
      completedSentence: false,
    }
  }

  next.activeWordIndex = tokens.length
  return {
    state: next,
    completedSentence: true,
  }
}

export function revealLetterInState(
  state: EnglishWordState,
  tokens: string[],
  revealComparableIndices: number[][],
) {
  const next = cloneWordState(state)
  const nextRevealComparableIndices = revealComparableIndices.map((item) => [...item])
  const activeIndex = next.activeWordIndex

  if (activeIndex < 0 || activeIndex >= tokens.length) {
    return {
      state: next,
      revealComparableIndices: nextRevealComparableIndices,
      completedSentence: activeIndex >= tokens.length,
    }
  }

  const normalizedExpected = normalizeComparableToken(tokens[activeIndex] || '')
  if (!normalizedExpected) {
    const completed = completeActiveWordInState(next, tokens)
    return {
      state: completed.state,
      revealComparableIndices: nextRevealComparableIndices,
      completedSentence: completed.completedSentence,
    }
  }

  const currentLength = normalizeComparableToken(next.currentWordInput).length
  const nextInput = normalizedExpected.slice(0, Math.min(normalizedExpected.length, currentLength + 1))
  next.currentWordInput = nextInput
  next.wordInputs[activeIndex] = nextInput
  next.wordStatuses[activeIndex] = 'active'

  const revealIndex = Math.max(0, nextInput.length - 1)
  if (!nextRevealComparableIndices[activeIndex]) {
    nextRevealComparableIndices[activeIndex] = []
  }
  if (!nextRevealComparableIndices[activeIndex].includes(revealIndex)) {
    nextRevealComparableIndices[activeIndex].push(revealIndex)
    nextRevealComparableIndices[activeIndex].sort((left, right) => left - right)
  }

  if (nextInput.length >= normalizedExpected.length) {
    const completed = completeActiveWordInState(next, tokens)
    return {
      state: completed.state,
      revealComparableIndices: nextRevealComparableIndices,
      completedSentence: completed.completedSentence,
    }
  }

  return {
    state: next,
    revealComparableIndices: nextRevealComparableIndices,
    completedSentence: false,
  }
}

export function buildSentenceInputText(wordInputs: string[]) {
  return wordInputs.join(' ').trim()
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tagName = String(target.tagName || '').toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export function shouldKeepEnglishPracticeControlFocus(target: EventTarget | null) {
  if (!target || !(target instanceof HTMLElement)) return false
  if (isEditableShortcutTarget(target)) return true
  return Boolean(target.closest('button, a, label, [role="button"], [role="link"], [data-english-control-focus="true"]'))
}

export function isTouchPrimaryInputDevice() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (window.matchMedia('(pointer: coarse)').matches) return true
  if (typeof navigator === 'undefined') return false
  return Number(navigator.maxTouchPoints || 0) > 0
}
