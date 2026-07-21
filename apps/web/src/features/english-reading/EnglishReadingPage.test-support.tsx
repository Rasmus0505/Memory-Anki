import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import type {
  ReadingDictionaryEntry,
  ReadingMaterial,
  ReadingProfile,
  ReadingSentenceTranslationResponse,
  ReadingVersion,
  ReadingWorkspaceResponse,
} from "@/shared/api/contracts";
import EnglishReadingPage from "@/features/english-reading/EnglishReadingPage";

const englishReadingPageMocks = vi.hoisted(() => ({
  completeEnglishReadingMaterialApiMock: vi.fn(),
  createEnglishReadingMaterialApiMock: vi.fn(),
  deleteEnglishReadingMaterialApiMock: vi.fn(),
  generateEnglishReadingVersionStreamApiMock: vi.fn(),
  getEnglishReadingDictionaryApiMock: vi.fn(),
  getEnglishReadingMaterialApiMock: vi.fn(),
  translateEnglishReadingSentenceApiMock: vi.fn(),
  getEnglishReadingWorkspaceApiMock: vi.fn(),
  getEnglishReadingVersionApiMock: vi.fn(),
  updateEnglishReadingMaterialApiMock: vi.fn(),
  updateEnglishReadingProfileApiMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  promptForAiOptionsMock: vi.fn(),
  timer: {
    sessionId: "reading-timer-1",
    effectiveSeconds: 180,
    idleSeconds: 0,
    pauseCount: 0,
    startedAt: null as string | null,
    status: "idle",
    durationEdited: false,
    glowState: "idle",
    adjustDuration: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    leaveScene: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn(),
    pause: vi.fn(),
    registerActivity: vi.fn(),
    reset: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
  },
}));

export const mocks = englishReadingPageMocks;

vi.mock("@/features/english-reading/api", () => ({
  completeEnglishReadingMaterialApi:
    englishReadingPageMocks.completeEnglishReadingMaterialApiMock,
  createEnglishReadingMaterialApi:
    englishReadingPageMocks.createEnglishReadingMaterialApiMock,
  deleteEnglishReadingMaterialApi:
    englishReadingPageMocks.deleteEnglishReadingMaterialApiMock,
  generateEnglishReadingVersionStreamApi:
    englishReadingPageMocks.generateEnglishReadingVersionStreamApiMock,
  getEnglishReadingDictionaryApi:
    englishReadingPageMocks.getEnglishReadingDictionaryApiMock,
  getEnglishReadingMaterialApi:
    englishReadingPageMocks.getEnglishReadingMaterialApiMock,
  translateEnglishReadingSentenceApi:
    englishReadingPageMocks.translateEnglishReadingSentenceApiMock,
  getEnglishReadingWorkspaceApi:
    englishReadingPageMocks.getEnglishReadingWorkspaceApiMock,
  getEnglishReadingVersionApi:
    englishReadingPageMocks.getEnglishReadingVersionApiMock,
  updateEnglishReadingMaterialApi:
    englishReadingPageMocks.updateEnglishReadingMaterialApiMock,
  updateEnglishReadingProfileApi:
    englishReadingPageMocks.updateEnglishReadingProfileApiMock,
}));

vi.mock("@/shared/hooks/useTimedSession", () => ({
  useTimedSession: () => ({
    ...englishReadingPageMocks.timer,
  }),
}));

vi.mock("@/entities/ai-runtime", () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) =>
      englishReadingPageMocks.promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}));

vi.mock("@/shared/components/session/SessionTimerBar", () => ({
  SessionTimerBar: () => <div data-testid="session-timer-bar" />,
}));

vi.mock("sonner", () => ({
  toast: {
    error: englishReadingPageMocks.toastErrorMock,
    success: englishReadingPageMocks.toastSuccessMock,
  },
}));

export function buildProfile(
  overrides: Partial<ReadingProfile> = {},
): ReadingProfile {
  return {
    declaredCefr: "B1",
    workingLexicalI: 2.4,
    workingSyntacticI: 2.25,
    xp: 28,
    levelProgress: 28,
    confidence: 0.61,
    ...overrides,
  };
}

export function buildMaterial(
  overrides: Partial<ReadingMaterial> = {},
): ReadingMaterial {
  return {
    id: 42,
    title: "Important acquisition was recalcitrant.",
    sourceType: "paste",
    originalFilename: "",
    wordCount: 4,
    latestVersionId: 7,
    createdAt: "2026-06-10T08:00:00",
    updatedAt: "2026-06-10T08:00:00",
    ...overrides,
  };
}

export function buildWorkspace(
  overrides: Partial<ReadingWorkspaceResponse> = {},
): ReadingWorkspaceResponse {
  return {
    profile: buildProfile(),
    stats: {
      totalMaterials: 3,
      generatedMaterials: 2,
      completedSessions: 1,
      todayReadingSeconds: 420,
      weeklyReadingSeconds: 1260,
      totalReadingSeconds: 3600,
    },
    recentMaterials: [
      buildMaterial(),
      buildMaterial({
        id: 43,
        title: "Napoleon reading material",
        latestVersionId: null,
      }),
    ],
    ...overrides,
  };
}

export function buildVersion(
  overrides: Partial<ReadingVersion> = {},
): ReadingVersion {
  return {
    id: 7,
    materialId: 42,
    declaredCefr: "B1",
    workingLexicalI: 2.4,
    workingSyntacticI: 2.25,
    targetCefr: "B2",
    targetLexicalI: 3.15,
    targetSyntacticI: 2.9,
    renderBlocks: [
      {
        id: "paragraph-1",
        sentences: [
          {
            id: "sentence-1",
            sentenceAnnotationId: "sentence-1-annotation",
            displayText: "Crucial acquisition was stubborn.",
            parts: [
              { text: "Crucial", spanAnnotationId: "span-1" },
              { text: " " },
              { text: "acquisition", spanAnnotationId: "span-2" },
              { text: " was " },
              { text: "stubborn", spanAnnotationId: "span-3" },
              { text: "." },
            ],
          },
        ],
      },
    ],
    spanAnnotations: [
      {
        id: "span-1",
        kind: "yellow",
        originalText: "Important",
        displayText: "Crucial",
        cefr: "A1",
        originalCefr: "A1",
        finalCefr: "B1",
        rewriteNeeded: true,
        rewriteDecision: "upgraded_to_i_plus_1",
        resolvedLemma: "important",
        resolutionSource: "dictionary",
      },
      {
        id: "span-2",
        kind: "green",
        originalText: "acquisition",
        displayText: "acquisition",
        cefr: "B2",
        originalCefr: "B2",
        finalCefr: "B2",
        rewriteNeeded: false,
        rewriteDecision: "kept_original_i_plus_1",
        resolvedLemma: "acquire",
        resolutionSource: "dictionary",
      },
      {
        id: "span-3",
        kind: "red",
        originalText: "recalcitrant",
        displayText: "stubborn",
        cefr: "C1",
        originalCefr: "C1",
        finalCefr: "A2",
        rewriteNeeded: true,
        rewriteDecision: "downgraded_to_i_plus_1",
        resolvedLemma: "recalcitrant",
        resolutionSource: "ai",
      },
    ],
    sentenceAnnotations: [
      {
        id: "sentence-1-annotation",
        kind: "syntax_simplified",
        originalText: "Important acquisition was recalcitrant.",
        displayText: "Crucial acquisition was stubborn.",
        skeletonHints: ["主语", "谓语"],
      },
    ],
    summary: {
      wordCount: 4,
      comfortCount: 1,
      growthCount: 2,
      greenCount: 1,
      yellowCount: 1,
      redCount: 1,
      sentenceSimplifiedCount: 1,
      workingLexicalI: 2.4,
      workingSyntacticI: 2.25,
      targetLexicalI: 3.15,
      targetSyntacticI: 2.9,
      targetCefr: "B2",
    },
    generationTrace: [],
    aiLogIds: [],
    createdAt: "2026-06-10T08:00:01",
    ...overrides,
  };
}

export function buildDictionaryEntry(
  overrides: Partial<ReadingDictionaryEntry> = {},
): ReadingDictionaryEntry {
  return {
    word: "acquisition",
    lemma: "acquisition",
    phoneticUs: "/ˌæk.wəˈzɪʃ.ən/",
    audioUsUrl:
      "https://dict.youdao.com/dictvoice?audio=acquisition&type=2",
    summaryZh: ["获得；购置；收购"],
    partsOfSpeech: ["n"],
    senses: [
      {
        partOfSpeech: "n",
        definitionZh: "获得某物的行为。",
        definition: "The act of acquiring something.",
        exampleZh: null,
        example: null,
      },
    ],
    source: "xxapi",
    cachedAt: "2026-06-12T15:00:00",
    ...overrides,
  };
}

export function buildSentenceTranslationResponse(
  overrides: Partial<ReadingSentenceTranslationResponse> = {},
): ReadingSentenceTranslationResponse {
  return {
    originalText: "Crucial acquisition was stubborn.",
    translatedText: "关键的收购曾经很顽固。",
    ...overrides,
  };
}

export function mockSentenceSelection(options?: {
  node?: Node;
  text?: string;
  rect?: Partial<DOMRect>;
}) {
  const rect = {
    left: 140,
    top: 200,
    right: 420,
    bottom: 236,
    width: 280,
    height: 36,
    x: 140,
    y: 200,
    toJSON: () => ({}),
    ...options?.rect,
  } satisfies DOMRect;
  let activeText = options?.text ?? "Crucial acquisition was stubborn.";
  let activeRangeCount = 1;
  let activeCollapsed = false;
  const removeAllRanges = vi.fn(() => {
    activeText = "";
    activeRangeCount = 0;
    activeCollapsed = true;
  });
  const selection = {
    get rangeCount() {
      return activeRangeCount;
    },
    get isCollapsed() {
      return activeCollapsed;
    },
    toString: () => activeText,
    getRangeAt: () => ({
      startContainer: options?.node ?? document.body,
      endContainer: options?.node ?? document.body,
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect],
    }),
    removeAllRanges,
  };
  Object.defineProperty(window, "getSelection", {
    configurable: true,
    value: () => selection,
  });
  return { selection, removeAllRanges };
}

export function setupEnglishReadingPageTest() {
  vi.useRealTimers();
  mocks.completeEnglishReadingMaterialApiMock.mockReset();
  mocks.createEnglishReadingMaterialApiMock.mockReset();
  mocks.deleteEnglishReadingMaterialApiMock.mockReset();
  mocks.generateEnglishReadingVersionStreamApiMock.mockReset();
  mocks.getEnglishReadingDictionaryApiMock.mockReset();
  mocks.getEnglishReadingMaterialApiMock.mockReset();
  mocks.translateEnglishReadingSentenceApiMock.mockReset();
  mocks.getEnglishReadingWorkspaceApiMock.mockReset();
  mocks.getEnglishReadingVersionApiMock.mockReset();
  mocks.updateEnglishReadingMaterialApiMock.mockReset();
  mocks.updateEnglishReadingProfileApiMock.mockReset();
  mocks.toastErrorMock.mockReset();
  mocks.toastSuccessMock.mockReset();
  mocks.promptForAiOptionsMock.mockReset();
  mocks.promptForAiOptionsMock.mockResolvedValue({});
  mocks.timer.adjustDuration.mockReset();
  mocks.timer.complete.mockClear();
  mocks.timer.leaveScene.mockClear();
  mocks.timer.logEvent.mockClear();
  mocks.timer.pause.mockReset();
  mocks.timer.registerActivity.mockReset();
  mocks.timer.reset.mockReset();
  mocks.timer.resume.mockReset();
  mocks.timer.start.mockReset();
  mocks.timer.startedAt = null;
  mocks.timer.status = "idle";
  mocks.getEnglishReadingWorkspaceApiMock.mockResolvedValue(buildWorkspace());
  mocks.createEnglishReadingMaterialApiMock.mockResolvedValue(buildMaterial());
  mocks.generateEnglishReadingVersionStreamApiMock.mockResolvedValue(
    buildVersion(),
  );
  mocks.getEnglishReadingDictionaryApiMock.mockResolvedValue(
    buildDictionaryEntry(),
  );
  mocks.translateEnglishReadingSentenceApiMock.mockResolvedValue(
    buildSentenceTranslationResponse(),
  );
  mocks.getEnglishReadingMaterialApiMock.mockResolvedValue(buildMaterial());
  mocks.getEnglishReadingVersionApiMock.mockResolvedValue(buildVersion());
  mocks.updateEnglishReadingMaterialApiMock.mockImplementation(
    async (materialId: number, payload: { title: string }) =>
      buildMaterial({ id: materialId, title: payload.title }),
  );
  mocks.deleteEnglishReadingMaterialApiMock.mockResolvedValue({
    deletedMaterialId: 43,
  });

  const playMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "Audio",
    vi.fn().mockImplementation(() => ({
      play: playMock,
      pause: vi.fn(),
    })),
  );
  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    speak: vi.fn(),
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    vi.fn().mockImplementation((text: string) => ({
      text,
      lang: "",
    })),
  );
  Object.defineProperty(window, "getSelection", {
    configurable: true,
    value: () => ({
      rangeCount: 0,
      isCollapsed: true,
      toString: () => "",
      removeAllRanges: vi.fn(),
    }),
  });
}

export function renderPage(initialEntries = ["/english/reading"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/english/reading" element={<EnglishReadingPage />} />
        <Route
          path="/english/reading/materials/:materialId"
          element={<EnglishReadingPage />}
        />
        <Route path="/english-reading" element={<EnglishReadingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
