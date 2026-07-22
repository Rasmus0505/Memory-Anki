import type { AiRuntimeOptions, ResolvedAiRuntimeMeta } from './profile';

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type ReadingGenerationMode = "initial" | "regenerate";
export type ReadingDifficultyDirection = "easier" | "same" | "harder";
export type ReadingDifficultyDelta = 0.5 | 1 | 1.5 | 2;

export interface ReadingProfile {
  declaredCefr: CefrLevel;
  workingLexicalI: number;
  workingSyntacticI: number;
  xp: number;
  levelProgress: number;
  confidence: number;
}

export interface ReadingWorkspaceStats {
  totalMaterials: number;
  generatedMaterials: number;
  completedSessions: number;
  todayReadingSeconds: number;
  weeklyReadingSeconds: number;
  totalReadingSeconds: number;
}

export interface ReadingMaterial {
  id: number;
  title: string;
  sourceType: "paste" | "txt" | "md" | "pdf";
  originalFilename: string;
  wordCount: number;
  latestVersionId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SpanAnnotation {
  id: string;
  kind: "green" | "yellow" | "red" | "black";
  originalText: string;
  displayText: string;
  cefr: string;
  originalCefr: string;
  finalCefr: string;
  rewriteNeeded: boolean;
  rewriteDecision: string;
  resolvedLemma: string;
  resolutionSource: "dictionary" | "ai";
}

export interface SentenceAnnotation {
  id: string;
  kind: "unchanged" | "syntax_simplified";
  originalText: string;
  displayText: string;
  skeletonHints: string[];
}

export interface ReadingRenderSentencePart {
  text: string;
  spanAnnotationId?: string;
}

export interface ReadingRenderSentence {
  id: string;
  parts: ReadingRenderSentencePart[];
  sentenceAnnotationId: string;
  displayText: string;
}

export interface ReadingRenderBlock {
  id: string;
  sentences: ReadingRenderSentence[];
}

export interface ReadingVersionSummary {
  wordCount: number;
  comfortCount: number;
  growthCount: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  sentenceSimplifiedCount: number;
  workingLexicalI: number;
  workingSyntacticI: number;
  targetLexicalI: number;
  targetSyntacticI: number;
  targetCefr: CefrLevel;
  _resolvedAi?: Record<string, ResolvedAiRuntimeMeta | null> | null;
}

export interface ReadingGenerationTraceItem {
  stage: string;
  step: number;
  totalSteps: number;
  message: string;
  stats?: Record<string, unknown>;
}

export interface ReadingVersion {
  id: number;
  materialId: number;
  declaredCefr: CefrLevel;
  workingLexicalI: number;
  workingSyntacticI: number;
  targetCefr: CefrLevel;
  targetLexicalI: number;
  targetSyntacticI: number;
  renderBlocks: ReadingRenderBlock[];
  spanAnnotations: SpanAnnotation[];
  sentenceAnnotations: SentenceAnnotation[];
  summary: ReadingVersionSummary;
  generationTrace: ReadingGenerationTraceItem[];
  aiLogIds: string[];
  createdAt: string | null;
}

export interface ReadingDictionarySense {
  partOfSpeech: string;
  definitionZh: string | null;
  definition: string;
  exampleZh?: string | null;
  example: string | null;
}

export interface ReadingDictionaryEntry {
  word: string;
  lemma: string;
  phoneticUs: string;
  audioUsUrl: string | null;
  summaryZh: string[];
  partsOfSpeech: string[];
  senses: ReadingDictionarySense[];
  source: string;
  cachedAt: string | null;
}

export interface ReadingSentenceTranslationResponse {
  originalText: string;
  translatedText: string;
  resolved_ai?: ResolvedAiRuntimeMeta | null;
}

export interface ReadingSessionResult {
  id: number;
  materialId: number;
  versionId: number | null;
  feedback: "too_easy" | "just_right" | "too_hard";
  durationSeconds: number;
  wordsPerMinute: number;
  hoverCount: number;
  expandCount: number;
  xpAwarded: number;
  calibration: {
    feedback: string;
    lexicalDelta: number;
    syntacticDelta: number;
    confidenceDelta: number;
    leveledUp: boolean;
    nextDeclaredCefr: CefrLevel;
  };
  completedAt: string | null;
}

export interface ReadingCompletionResponse {
  material: ReadingMaterial;
  profile: ReadingProfile;
  session: ReadingSessionResult;
}

export type ReadingVocabularyReviewResult = "forgot" | "hard" | "good" | "easy";

export interface ReadingVocabularyNote {
  id: number;
  word: string;
  normalizedSurface: string;
  lemma: string;
  cefr: CefrLevel | null;
  note: string;
  definitionZh: string;
  context: string;
  materialId: number | null;
  versionId: number | null;
  spanAnnotationId: string | null;
  status: "active" | "mastered";
  reviewNumber: number;
  reviewCount: number;
  correctCount: number;
  incorrectCount: number;
  nextDueDate: string | null;
  nextDueAt: string | null;
  intervalDays: number;
  reviewType: string;
  algorithmUsed: string;
  anchorDate: string | null;
  lastReviewedAt: string | null;
  isDue: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReadingVocabularyNotesResponse {
  items: ReadingVocabularyNote[];
  dueCount: number;
  total: number;
}

export interface ReadingVocabularyNoteCreateRequest {
  word: string;
  note?: string;
  definitionZh?: string;
  context?: string;
  materialId?: number | null;
  versionId?: number | null;
  spanAnnotationId?: string;
  cefr?: CefrLevel | null;
}

export interface ReadingWorkspaceResponse {
  profile: ReadingProfile;
  stats: ReadingWorkspaceStats;
  recentMaterials: ReadingMaterial[];
}

export interface ReadingGenerateRequest {
  mode: ReadingGenerationMode;
  difficultyDirection?: ReadingDifficultyDirection;
  difficultyDelta?: ReadingDifficultyDelta;
  ai_options?: AiRuntimeOptions;
}

export type ReadingArticleKind = 'source' | 'generated'
export type ReadingTargetType = 'word' | 'sentence'

export interface ReadingExplanation {
  id: number
  targetId: number
  operationId: string
  type: ReadingTargetType
  cefr: CefrLevel
  status: string
  result: Record<string, unknown>
  createdAt: string | null
}

export interface ReadingArticleSummary {
  id: number
  title: string
  kind: ReadingArticleKind
  sourceType: string
  originalFilename: string
  wordCount: number
  depth: number
  parentArticleId: number | null
  generationConfig: Record<string, unknown>
  createdAt: string | null
  updatedAt: string | null
}

export interface ReadingTarget {
  id: number
  articleId: number
  type: ReadingTargetType
  startOffset: number
  endOffset: number
  quote: string
  normalizedValue: string
  priority: number
  explanations: ReadingExplanation[]
  linkedArticles: ReadingArticleSummary[]
}

export interface ReadingArticle extends ReadingArticleSummary {
  content: string
  targets: ReadingTarget[]
}

export interface ReadingArticleTreeItem extends ReadingArticleSummary {
  children: ReadingArticleTreeItem[]
}

export interface ReadingArticlesResponse {
  items: ReadingArticleSummary[]
  tree: ReadingArticleTreeItem[]
}

export interface ReadingArticleGenerationConfig {
  cefr: CefrLevel
  wordCount: 150 | 300 | 500
  genre: 'argumentative' | 'expository' | 'narrative' | 'dialogue'
  topic: string
  wordRepetitions: number
  sentenceVariants: number
  syntaxDensity: 'low' | 'normal' | 'high'
}

export type ReadingGenerateStreamStatusEvent = ReadingGenerationTraceItem;
