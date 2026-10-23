import { describe, expect, it } from 'vitest'
import {
  backspaceDictationChar,
  buildDictationInputText,
  buildDictationWords,
  clearWrongDictationWord,
  countDictationProgress,
  createDictationSession,
  getLetterState,
  getWordVisualStatus,
  resetDictationSession,
  revealDictationLetter,
  revealDictationWord,
  revealWholeDictationSession,
  typeDictationChar,
} from './model'

function typeText(session: ReturnType<typeof createDictationSession>, text: string) {
  let current = session
  let outcome = ''
  for (const char of text) {
    const step = typeDictationChar(current, char)
    current = step.session
    outcome = step.outcome
  }
  return { session: current, outcome }
}

describe('english dictation model', () => {
  it('keeps punctuation in display words while excluding it from the answer', () => {
    const words = buildDictationWords('"Hello," she said — quietly!')
    expect(words.map((word) => [word.lead, word.answer, word.trail])).toEqual([
      ['"', 'Hello', ',"'],
      ['', 'she', ''],
      ['', 'said', ''],
      ['—', 'quietly', '!'],
    ])
  })

  it('uses normalized tokens when display text cannot be typed directly', () => {
    const words = buildDictationWords('It costs $5.', ['it', 'costs', 'five', 'dollars'])
    expect(words.map((word) => word.answer)).toEqual(['it', 'costs', 'five', 'dollars'])
    expect(words.at(-1)?.trail).toBe('.')
  })

  it('judges whole words and advances the active word', () => {
    let session = createDictationSession(0, 'hello world')
    const typed = typeText(session, 'hello')
    session = typed.session
    expect(typed.outcome).toBe('word-correct')
    expect(session.activeWordIndex).toBe(1)
    expect(session.words[0].status).toBe('correct')
    expect(session.words[1].status).toBe('active')
  })

  it('marks a full wrong word, then clears it back to empty input', () => {
    const session = createDictationSession(0, 'hello')
    const typed = typeText(session, 'helox')
    expect(typed.outcome).toBe('word-wrong')
    expect(typed.session.words[0].status).toBe('wrong')
    expect(typed.session.words[0].chars).toHaveLength(5)
    const cleared = clearWrongDictationWord(typed.session, 0)
    expect(cleared.words[0].chars).toHaveLength(0)
    expect(cleared.words[0].status).toBe('active')
    expect(cleared.activeWordIndex).toBe(0)
  })

  it('backspaces only within the active word', () => {
    const typed = typeText(createDictationSession(0, 'hello world'), 'hel')
    const back = backspaceDictationChar(typed.session)
    expect(back.words[0].chars.map((char) => char.char).join('')).toBe('he')
    expect(back.words[0].status).toBe('active')
  })

  it('never advances a wrong word while it waits to be cleared', () => {
    const typed = typeText(createDictationSession(0, 'hello world'), 'helox')
    const extra = typeDictationChar(typed.session, 'x')
    expect(extra.outcome).toBe('ignored')
    expect(extra.session.words[0].chars).toHaveLength(5)
  })

  it('reveals one letter at a time and completes the word on the last letter', () => {
    let session = createDictationSession(0, 'cat')
    session = revealDictationLetter(session).session
    expect(session.words[0].chars).toEqual([{ char: 'c', hinted: true }])
    expect(getLetterState(session.words[0], 0, true)).toBe('hinted')
    session = revealDictationLetter(session).session
    const final = revealDictationLetter(session)
    expect(final.outcome).toBe('complete')
    expect(final.session.completed).toBe(true)
    expect(final.session.usedHint).toBe(true)
  })

  it('reveals a whole word and advances like manual completion', () => {
    const session = createDictationSession(0, 'hello world')
    const step = revealDictationWord(session)
    expect(step.outcome).toBe('word-correct')
    expect(step.session.words[0].chars.map((char) => char.char).join('')).toBe('hello')
    expect(step.session.words[0].chars.every((char) => char.hinted)).toBe(true)
    expect(step.session.activeWordIndex).toBe(1)
  })

  it('revealing a word replaces wrong typed letters with the answer', () => {
    const typed = typeText(createDictationSession(0, 'hello'), 'hexx')
    const step = revealDictationWord(typed.session)
    expect(step.outcome).toBe('complete')
    expect(step.session.words[0].status).toBe('correct')
    expect(step.session.words[0].chars.map((char) => char.char).join('')).toBe('hello')
    expect(step.session.words[0].chars.every((char) => char.hinted)).toBe(true)
  })

  it('completes a sentence through a mix of typing and hints', () => {
    let session = createDictationSession(0, 'we can do it', ['we', 'can', 'do', 'it'])
    session = typeText(session, 'we').session
    session = revealDictationWord(session).session
    session = typeText(session, 'do').session
    const final = revealDictationWord(session)
    expect(final.outcome).toBe('complete')
    expect(final.session.completed).toBe(true)
    expect(buildDictationInputText(final.session)).toBe('we can do it')
  })

  it('restores, resets, and reports counts', () => {
    const typed = typeText(createDictationSession(0, 'one two'), 'onx').session
    const solved = revealWholeDictationSession(typed)
    expect(solved.completed).toBe(true)
    expect(solved.words.every((word) => word.status === 'correct')).toBe(true)
    const reset = resetDictationSession(solved)
    expect(reset.completed).toBe(false)
    expect(reset.words[0].status).toBe('active')
    expect(reset.words[0].chars).toHaveLength(0)

    const partial = typeText(createDictationSession(0, 'one two'), 'one').session
    const counts = countDictationProgress(partial)
    expect(counts.totalWords).toBe(2)
    expect(counts.correctWords).toBe(1)
    expect(counts.typedLetters).toBe(3)
    expect(counts.errorLetters).toBe(0)
  })

  it('maps visual status so wrong words stay wrong even when active', () => {
    const session = createDictationSession(0, 'hello')
    session.words[0].status = 'wrong'
    expect(getWordVisualStatus(session.words[0], 0, session)).toBe('wrong')
  })

  it('accepts a plain hyphen for a typographic dash inside a word', () => {
    const session = createDictationSession(0, 'well—known')
    const typed = typeText(session, 'well-known')
    expect(typed.outcome).toBe('complete')
    expect(typed.session.words[0].status).toBe('correct')
  })

  it('treats letter comparison as case-insensitive and quote-insensitive', () => {
    const session = createDictationSession(0, "Don't Stop")
    const typed = typeText(session, "DON'T")
    expect(typed.outcome).toBe('word-correct')
    expect(typed.session.words[0].status).toBe('correct')
  })
})
