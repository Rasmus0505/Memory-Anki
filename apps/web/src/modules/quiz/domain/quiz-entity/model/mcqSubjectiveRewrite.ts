export type McqSubjectiveKind = 'except' | 'positive'

export interface McqSubjectiveRewriteInput {
  stem?: string
  options?: Array<{ id: string; text: string }>
  correctOptionId?: string
}

export interface McqSubjectiveRewrite {
  stem: string
  referenceAnswer: string
  kind: McqSubjectiveKind
}

const WHICH_ITEM_RE = /哪(?:一)?[项个种]/
const OPTION_SCAFFOLD_RE =
  /(?:以下|下列|下面)|哪(?:一)?[项个种]|正确的是|不正确的是|不符合|不属于|不包括/

function cleanTopic(raw: string) {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[（(]\s*[）)]\s*$/g, '')
    .replace(/[？?。．.、，,：:；;]+$/g, '')
    .replace(/的(?:表述|说法|叙述|描述)(?:中)?$/g, '')
    .replace(/的是$/g, '')
    .replace(/[（(]\s*[）)]\s*$/g, '')
    .trim()
}

function normalizeStem(stem: string) {
  return stem
    .replace(/\s+/g, ' ')
    .replace(/[（(]\s*[）)]\s*$/g, '')
    .trim()
}

function hasOptionScaffold(stem: string) {
  return OPTION_SCAFFOLD_RE.test(stem)
}

function exceptAsk(topic: string) {
  const cleaned = cleanTopic(topic)
  return cleaned ? `${cleaned}有哪些` : '有哪些'
}

function positiveAsk(topic: string) {
  const cleaned = cleanTopic(topic)
  if (!cleaned) return '简述其内容'
  if (/(实践|要求|规定|任务)/.test(cleaned)) return `${cleaned}要求什么`
  if (/(原则|观点|思想|主张|特点|内容|意义|作用|措施|途径)/.test(cleaned)) {
    return `${cleaned}有哪些`
  }
  return `简述${cleaned}`
}

function identityAsk(topic: string) {
  const cleaned = cleanTopic(topic)
  return cleaned ? `${cleaned}是什么` : '是什么'
}

function belongAsk(topic: string) {
  const cleaned = cleanTopic(topic)
  return cleaned ? `${cleaned}有哪些` : '有哪些'
}

function optionText(
  options: Array<{ id: string; text: string }> | undefined,
  optionId: string,
) {
  const match = (options || []).find((item) => item.id === optionId)
  return String(match?.text || '').trim()
}

function exceptReference(
  options: Array<{ id: string; text: string }> | undefined,
  correctOptionId: string,
) {
  return (options || [])
    .filter((item) => item.id !== correctOptionId)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('；')
}

function positiveReference(
  options: Array<{ id: string; text: string }> | undefined,
  correctOptionId: string,
) {
  return optionText(options, correctOptionId)
}

type Matcher = {
  kind: McqSubjectiveKind
  re: RegExp
  topic: (match: RegExpMatchArray) => string
  ask: (topic: string) => string
}

const MATCHERS: Matcher[] = [
  {
    kind: 'except',
    re: /^(?:以下|下列|下面)哪(?:一)?[项个种]?不(?:符合|属于|包括|是)(.+)$/,
    topic: (match) => match[1] || '',
    ask: exceptAsk,
  },
  {
    kind: 'except',
    re: /^(?:以下|下列|下面)(?:有关|关于)(.+?)的(?:表述|说法|叙述|描述)(?:中)?[，,]?不(?:正确|符合)的是.*$/,
    topic: (match) => match[1] || '',
    ask: exceptAsk,
  },
  {
    kind: 'except',
    re: /^关于(.+?)[，,].{0,16}不(?:正确|符合)的是.*$/,
    topic: (match) => match[1] || '',
    ask: exceptAsk,
  },
  {
    kind: 'except',
    re: /^(?:以下|下列|下面).{0,12}不(?:正确|符合|属于|包括)的是(.+)$/,
    topic: (match) => match[1] || '',
    ask: exceptAsk,
  },
  {
    kind: 'except',
    re: /^(.+?)(?:中)?不(?:正确|符合|属于)的是.*$/,
    topic: (match) => match[1] || '',
    ask: exceptAsk,
  },
  {
    kind: 'positive',
    re: /^(?:以下|下列|下面)有关(.+?)的(?:表述|说法|叙述|描述)中正确的是.*$/,
    topic: (match) => match[1] || '',
    ask: positiveAsk,
  },
  {
    kind: 'positive',
    re: /^(?:以下|下列|下面)关于(.+?)的(?:表述|说法|叙述|描述)(?:中)?[，,]?正确的是.*$/,
    topic: (match) => match[1] || '',
    ask: positiveAsk,
  },
  {
    kind: 'positive',
    re: /^关于(.+?)[，,].{0,20}正确的是.*$/,
    topic: (match) => match[1] || '',
    ask: positiveAsk,
  },
  {
    kind: 'positive',
    re: /^(?:以下|下列|下面)哪(?:一)?[项个种]?属于(.+)$/,
    topic: (match) => match[1] || '',
    ask: belongAsk,
  },
  {
    kind: 'positive',
    re: /^(?:以下|下列|下面)属于(.+?)的是.*$/,
    topic: (match) => match[1] || '',
    ask: belongAsk,
  },
  {
    kind: 'positive',
    re: /^(?:以下|下列|下面)哪(?:一)?[项个种]?是(.+)$/,
    topic: (match) => match[1] || '',
    ask: identityAsk,
  },
  {
    kind: 'positive',
    re: /^(?:以下|下列|下面)(?:哪(?:一)?[项个种]?)?(?:说法|表述)?正确的是.*$/,
    topic: () => '',
    ask: () => '简述其内容',
  },
]

function fallbackStem(normalized: string) {
  const stripped = normalized
    .replace(/^(?:以下|下列|下面)/, '')
    .replace(/哪(?:一)?[项个种]/g, '')
    .replace(/不(?:正确|符合|属于|包括)的是/g, '')
    .replace(/正确的是/g, '')
    .replace(/[（(]\s*[）)]/g, '')
    .trim()
  const cleaned = cleanTopic(stripped)
  if (!cleaned) return '简述其内容'
  if (/(实践|要求|规定|任务)/.test(cleaned)) return `${cleaned}要求什么`
  if (/(原则|观点|思想|主张|特点|内容|意义|作用|措施|途径)/.test(cleaned)) {
    return `${cleaned}有哪些`
  }
  if (/[是有]$/.test(cleaned)) return `${cleaned}什么`
  return `简述${cleaned}`
}

export function rewriteMcqForSubjective(input: McqSubjectiveRewriteInput): McqSubjectiveRewrite {
  const original = String(input.stem || '').trim()
  const normalized = normalizeStem(original)
  const correctOptionId = String(input.correctOptionId || '').trim()
  const matched = MATCHERS.reduce<McqSubjectiveRewrite | null>((found, matcher) => {
    if (found) return found
    const match = normalized.match(matcher.re)
    if (!match) return null
    const stem = matcher.ask(matcher.topic(match))
    if (!stem || WHICH_ITEM_RE.test(stem)) return null
    const kind = matcher.kind
    return {
      stem,
      kind,
      referenceAnswer:
        kind === 'except'
          ? exceptReference(input.options, correctOptionId)
          : positiveReference(input.options, correctOptionId),
    }
  }, null)

  if (matched) return matched

  if (!normalized || !hasOptionScaffold(normalized)) {
    return {
      stem: original,
      kind: 'positive',
      referenceAnswer: positiveReference(input.options, correctOptionId),
    }
  }

  return {
    stem: fallbackStem(normalized),
    kind: 'positive',
    referenceAnswer: positiveReference(input.options, correctOptionId),
  }
}
