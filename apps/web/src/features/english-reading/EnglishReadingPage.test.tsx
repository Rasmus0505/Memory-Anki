import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReadingDictionaryEntry,
  ReadingMaterial,
  ReadingProfile,
  ReadingSentenceTranslationResponse,
  ReadingVersion,
  ReadingWorkspaceResponse,
} from "@/shared/api/contracts";
import EnglishReadingPage from "@/features/english-reading/EnglishReadingPage";

const mocks = vi.hoisted(() => ({
  completeEnglishReadingMaterialApiMock: vi.fn(),
  createEnglishReadingMaterialApiMock: vi.fn(),
  deleteEnglishReadingMaterialApiMock: vi.fn(),
  generateEnglishReadingVersionApiMock: vi.fn(),
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

vi.mock("@/features/english-reading/api/englishReadingApi", () => ({
  completeEnglishReadingMaterialApi:
    mocks.completeEnglishReadingMaterialApiMock,
  createEnglishReadingMaterialApi: mocks.createEnglishReadingMaterialApiMock,
  deleteEnglishReadingMaterialApi: mocks.deleteEnglishReadingMaterialApiMock,
  generateEnglishReadingVersionApi: mocks.generateEnglishReadingVersionApiMock,
  getEnglishReadingDictionaryApi: mocks.getEnglishReadingDictionaryApiMock,
  getEnglishReadingMaterialApi: mocks.getEnglishReadingMaterialApiMock,
  translateEnglishReadingSentenceApi:
    mocks.translateEnglishReadingSentenceApiMock,
  getEnglishReadingWorkspaceApi: mocks.getEnglishReadingWorkspaceApiMock,
  getEnglishReadingVersionApi: mocks.getEnglishReadingVersionApiMock,
  updateEnglishReadingMaterialApi: mocks.updateEnglishReadingMaterialApiMock,
  updateEnglishReadingProfileApi: mocks.updateEnglishReadingProfileApiMock,
}));

vi.mock("@/shared/hooks/useTimedSession", () => ({
  useTimedSession: () => ({
    ...mocks.timer,
  }),
}));

vi.mock("@/features/ai-config/useAiRunConfigDialog", () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => mocks.promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}));

vi.mock("@/shared/components/session/SessionTimerBar", () => ({
  SessionTimerBar: () => <div data-testid="session-timer-bar" />,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastErrorMock,
    success: mocks.toastSuccessMock,
  },
}));

function buildProfile(overrides: Partial<ReadingProfile> = {}): ReadingProfile {
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

function buildMaterial(
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

function buildWorkspace(
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

function buildVersion(overrides: Partial<ReadingVersion> = {}): ReadingVersion {
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
        resolvedLemma: "important",
        resolutionSource: "dictionary",
      },
      {
        id: "span-2",
        kind: "green",
        originalText: "acquisition",
        displayText: "acquisition",
        cefr: "B2",
        resolvedLemma: "acquire",
        resolutionSource: "dictionary",
      },
      {
        id: "span-3",
        kind: "red",
        originalText: "recalcitrant",
        displayText: "stubborn",
        cefr: "C1",
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
    createdAt: "2026-06-10T08:00:01",
    ...overrides,
  };
}

function buildDictionaryEntry(
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

function buildSentenceTranslationResponse(
  overrides: Partial<ReadingSentenceTranslationResponse> = {},
): ReadingSentenceTranslationResponse {
  return {
    originalText: "Crucial acquisition was stubborn.",
    translatedText: "关键的收购曾经很顽固。",
    ...overrides,
  };
}

function mockSentenceSelection(options?: {
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

describe("EnglishReadingPage", () => {
beforeEach(() => {
    vi.useRealTimers();
    mocks.completeEnglishReadingMaterialApiMock.mockReset();
    mocks.createEnglishReadingMaterialApiMock.mockReset();
    mocks.deleteEnglishReadingMaterialApiMock.mockReset();
    mocks.generateEnglishReadingVersionApiMock.mockReset();
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
    mocks.timer.pause.mockReset();
    mocks.timer.registerActivity.mockReset();
    mocks.timer.reset.mockReset();
    mocks.timer.resume.mockReset();
    mocks.timer.start.mockReset();
    mocks.timer.startedAt = null;
    mocks.timer.status = "idle";
    mocks.getEnglishReadingWorkspaceApiMock.mockResolvedValue(buildWorkspace());
    mocks.createEnglishReadingMaterialApiMock.mockResolvedValue(
      buildMaterial(),
    );
    mocks.generateEnglishReadingVersionApiMock.mockResolvedValue(
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
  });

  it("creates i+1 material and expands the original sentence skeleton on click", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("建立我的 i")).toBeTruthy();
    expect(screen.getByText("最近阅读材料")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText(
        "直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。",
      ),
      {
        target: { value: "Important acquisition was recalcitrant." },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "开始定制我的 i+1 材料" }),
    );

    await waitFor(() => {
      expect(mocks.createEnglishReadingMaterialApiMock).toHaveBeenCalledWith({
        text: "Important acquisition was recalcitrant.",
        file: null,
      });
    });
    expect(mocks.generateEnglishReadingVersionApiMock).toHaveBeenCalledWith(
      42,
      { mode: "initial" },
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();
    expect(screen.getByText("acquisition")).toBeTruthy();
    expect(screen.getByText("stubborn")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开原句" }));

    expect(await screen.findByText("原句骨架")).toBeTruthy();
    expect(
      screen.getAllByText("Important acquisition was recalcitrant.").length,
    ).toBeGreaterThan(0);
    expect(mocks.timer.start).toHaveBeenCalled();
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith("i+1 阅读材料已生成。");
  });

  it("shows simplified hover metadata with CEFR, lemma, and source label", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const acquisition = await screen.findByText("acquisition");
    fireEvent.mouseEnter(acquisition);

    expect(await screen.findByText("B2:acquisition")).toBeTruthy();
    expect(screen.getByText("还原：acquire")).toBeTruthy();
    expect(screen.getAllByText("标记：词典").length).toBeGreaterThan(0);
  });

  it("looks up a clicked word, opens the dictionary card, and auto-plays pronunciation", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const acquisition = await screen.findByRole("button", {
      name: "acquisition",
    });
    fireEvent.click(acquisition);

    await waitFor(() => {
      expect(mocks.getEnglishReadingDictionaryApiMock).toHaveBeenCalledWith(
        "acquisition",
      );
    });
    expect(
      mocks.translateEnglishReadingSentenceApiMock,
    ).not.toHaveBeenCalled();
    expect(await screen.findByText("美 /ˌæk.wəˈzɪʃ.ən/")).toBeTruthy();
    expect(screen.getByText("n")).toBeTruthy();
    expect(screen.getByText("获得；购置；收购")).toBeTruthy();
    expect(screen.getByText("获得某物的行为。")).toBeTruthy();
    expect(screen.getByText("The act of acquiring something.")).toBeTruthy();
    expect(screen.getByTestId("dictionary-popup-scroll")).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });

  it("keeps the dictionary popup open while scrolling inside it", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const acquisition = await screen.findByRole("button", {
      name: "acquisition",
    });
    fireEvent.click(acquisition);

    const scrollContainer = await screen.findByTestId("dictionary-popup-scroll");
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 80 } });

    expect(screen.getByTestId("dictionary-popup-panel")).toBeTruthy();
    expect(screen.getByText("获得某物的行为。")).toBeTruthy();
    expect(screen.getByText("The act of acquiring something.")).toBeTruthy();
  });

  it("keeps popup position after pinning and updates content for the next word", async () => {
    mocks.getEnglishReadingDictionaryApiMock.mockImplementation(
      async (word: string) => {
        if (word === "stubborn") {
          return buildDictionaryEntry({
            word: "stubborn",
            lemma: "stubborn",
            phoneticUs: "/ˈstʌb.ɚn/",
            summaryZh: ["固执的；顽固的"],
            partsOfSpeech: ["adj"],
            senses: [
              {
                partOfSpeech: "adj",
                definitionZh: "固执的；顽固的。",
                definition: "",
                exampleZh: null,
                example: null,
              },
            ],
            source: "xxapi",
          });
        }
        return buildDictionaryEntry();
      },
    );

    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const acquisition = await screen.findByRole("button", {
      name: "acquisition",
    });
    const stubborn = screen.getByRole("button", { name: "stubborn" });

    Object.defineProperty(acquisition, "getBoundingClientRect", {
      value: () =>
        ({
          left: 80,
          top: 120,
          bottom: 144,
          right: 170,
          width: 90,
          height: 24,
          x: 80,
          y: 120,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    });
    Object.defineProperty(stubborn, "getBoundingClientRect", {
      value: () =>
        ({
          left: 420,
          top: 220,
          bottom: 244,
          right: 500,
          width: 80,
          height: 24,
          x: 420,
          y: 220,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    });

    fireEvent.click(acquisition);
    await screen.findByText("获得；购置；收购");
    const panel = await screen.findByTestId("dictionary-popup-panel");
    const initialLeft = panel.style.left;
    const initialTop = panel.style.top;
    fireEvent.click(screen.getByRole("button", { name: "固定词典面板" }));
    fireEvent.click(stubborn);

    await waitFor(() => {
      expect(mocks.getEnglishReadingDictionaryApiMock).toHaveBeenCalledWith(
        "stubborn",
      );
    });
    expect(await screen.findByText("固执的；顽固的")).toBeTruthy();
    expect(screen.getByText("固执的；顽固的。")).toBeTruthy();
    expect(panel.style.left).toBe(initialLeft);
    expect(panel.style.top).toBe(initialTop);
  });

  it("shows a translate trigger after long-press selection and keeps original words clickable", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const crucial = await screen.findByRole("button", { name: "Crucial" });
    mockSentenceSelection({ node: crucial });

    fireEvent.pointerDown(crucial, { button: 0, pointerId: 11 });
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    fireEvent.pointerUp(document, { pointerId: 11 });

    const trigger = await screen.findByTestId("sentence-translation-trigger");
    expect(mocks.translateEnglishReadingSentenceApiMock).not.toHaveBeenCalled();

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(mocks.translateEnglishReadingSentenceApiMock).toHaveBeenCalledWith(
        "Crucial acquisition was stubborn.",
      );
    });

    const panel = await screen.findByTestId("sentence-translation-panel");
    expect(panel).toBeTruthy();
    expect(Number.parseFloat(panel.style.maxHeight)).toBeGreaterThan(300);
    expect(
      screen.getByTestId("sentence-translation-text").textContent,
    ).toContain("关键的收购曾经很顽固。");

    fireEvent.click(
      within(screen.getByTestId("sentence-translation-original")).getByRole(
        "button",
        { name: "acquisition" },
      ),
    );
    await waitFor(() => {
      expect(mocks.getEnglishReadingDictionaryApiMock).toHaveBeenCalledWith(
        "acquisition",
      );
    });
  });

  it("shows the translate trigger after drag-selecting a sentence", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const crucial = await screen.findByRole("button", { name: "Crucial" });
    mockSentenceSelection({ node: crucial });

    fireEvent.pointerDown(crucial, {
      button: 0,
      pointerId: 31,
      clientX: 80,
      clientY: 120,
    });
    fireEvent.pointerMove(document, {
      pointerId: 31,
      clientX: 96,
      clientY: 120,
    });
    fireEvent.pointerUp(document, { pointerId: 31 });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(await screen.findByTestId("sentence-translation-trigger")).toBeTruthy();
  });

  it("does not show the translate trigger for invalid or cancelled selections", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const crucial = await screen.findByRole("button", { name: "Crucial" });

    mockSentenceSelection({ node: crucial, text: "Crucial" });
    fireEvent.pointerDown(crucial, { button: 0, pointerId: 41 });
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    fireEvent.pointerUp(document, { pointerId: 41 });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.queryByTestId("sentence-translation-trigger")).toBeNull();

    mockSentenceSelection({ node: crucial });
    fireEvent.pointerDown(crucial, { button: 0, pointerId: 42 });
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    fireEvent.pointerCancel(document, { pointerId: 42 });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.queryByTestId("sentence-translation-trigger")).toBeNull();
  });

  it("reuses the cached sentence translation for the same selection", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const crucial = await screen.findByRole("button", { name: "Crucial" });
    mockSentenceSelection({ node: crucial });

    fireEvent.pointerDown(crucial, { button: 0, pointerId: 21 });
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    fireEvent.pointerUp(document, { pointerId: 21 });

    fireEvent.click(await screen.findByTestId("sentence-translation-trigger"));
    await screen.findByTestId("sentence-translation-panel");
    expect(mocks.translateEnglishReadingSentenceApiMock).toHaveBeenCalledTimes(
      1,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭句子翻译" }));

    mockSentenceSelection({ node: crucial });
    fireEvent.pointerDown(crucial, { button: 0, pointerId: 22 });
    await new Promise((resolve) => window.setTimeout(resolve, 330));
    fireEvent.pointerUp(document, { pointerId: 22 });

    fireEvent.click(await screen.findByTestId("sentence-translation-trigger"));
    await screen.findByTestId("sentence-translation-panel");
    expect(mocks.translateEnglishReadingSentenceApiMock).toHaveBeenCalledTimes(
      1,
    );
  });

  it("allows dragging the popup after pinning it", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    const acquisition = await screen.findByRole("button", {
      name: "acquisition",
    });
    Object.defineProperty(acquisition, "getBoundingClientRect", {
      value: () =>
        ({
          left: 120,
          top: 140,
          bottom: 164,
          right: 220,
          width: 100,
          height: 24,
          x: 120,
          y: 140,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    });

    fireEvent.click(acquisition);
    fireEvent.click(await screen.findByRole("button", { name: "固定词典面板" }));

    const panel = screen.getByTestId("dictionary-popup-panel");
    const header = screen.getByTestId("dictionary-popup-header");
    const initialLeft = panel.style.left;
    const initialTop = panel.style.top;

    fireEvent.mouseDown(header, {
      clientX: 120,
      clientY: 120,
    });
    fireEvent.mouseMove(document, {
      clientX: 200,
      clientY: 180,
    });
    fireEvent.mouseUp(document, {
      clientX: 200,
      clientY: 180,
    });

    expect(panel.style.left).not.toBe(initialLeft);
    expect(panel.style.top).not.toBe(initialTop);
  });

  it("opens regenerate dialog and regenerates at the same difficulty by default", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));

    expect(await screen.findByText("难度变化幅度")).toBeTruthy();
    expect(screen.getByText("0.5 级")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(
        mocks.generateEnglishReadingVersionApiMock,
      ).toHaveBeenLastCalledWith(42, {
        mode: "regenerate",
        difficultyDirection: "same",
      });
    });
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith(
      "已重新生成当前内容。",
    );
  });

  it("regenerates with easier direction and selected delta", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));
    fireEvent.click(screen.getByRole("button", { name: /降低难度/ }));
    fireEvent.change(screen.getByLabelText("难度变化幅度"), {
      target: { value: "1.5" },
    });

    expect(screen.getByText("1.5 级")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(
        mocks.generateEnglishReadingVersionApiMock,
      ).toHaveBeenLastCalledWith(42, {
        mode: "regenerate",
        difficultyDirection: "easier",
        difficultyDelta: 1.5,
      });
    });
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith(
      "已按更简单的难度重新生成。",
    );
  });

  it("regenerates with harder direction", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));
    fireEvent.click(screen.getByRole("button", { name: /提升难度/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(
        mocks.generateEnglishReadingVersionApiMock,
      ).toHaveBeenLastCalledWith(42, {
        mode: "regenerate",
        difficultyDirection: "harder",
        difficultyDelta: 0.5,
      });
    });
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith(
      "已按更高的难度重新生成。",
    );
  });

  it("keeps regenerate dialog open when regeneration fails", async () => {
    mocks.generateEnglishReadingVersionApiMock.mockRejectedValueOnce(
      new Error("生成失败"),
    );

    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(mocks.toastErrorMock).toHaveBeenCalledWith("生成失败");
    });
    expect(screen.getByText("难度变化幅度")).toBeTruthy();
  });

  it("accepts drag-and-drop file upload and uses the dropped file as the active source", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("建立我的 i")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText(
        "直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。",
      ),
      {
        target: { value: "This text should not be uploaded." },
      },
    );

    const droppedFile = new File(["# Reader\n\nHello world"], "reader.md", {
      type: "text/markdown",
    });
    fireEvent.drop(screen.getByTestId("reading-file-dropzone"), {
      dataTransfer: {
        files: [droppedFile],
      },
    });

    expect(screen.getByText("已选择文件：reader.md")).toBeTruthy();
    expect(
      screen.getByText(
        "当前将按文件导入生成。继续编辑上方正文可切回粘贴导入。",
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "开始定制我的 i+1 材料" }),
    );

    await waitFor(() => {
      expect(mocks.createEnglishReadingMaterialApiMock).toHaveBeenCalledWith({
        text: "",
        file: droppedFile,
      });
    });
  });

  it("opens a recent material from history and loads its version", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Napoleon reading material")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /打开/i })[1]);

    await waitFor(() => {
      expect(mocks.getEnglishReadingMaterialApiMock).toHaveBeenCalledWith(43);
      expect(mocks.getEnglishReadingVersionApiMock).toHaveBeenCalledWith(43);
    });
  });

  it("records reading time when leaving the page without manual completion", async () => {
    mocks.timer.startedAt = "2026-06-12T10:00:00";
    mocks.timer.status = "running";

    const view = render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    view.unmount();

    await waitFor(() => {
      expect(mocks.timer.leaveScene).toHaveBeenCalledWith({
        source: "english_reading_leave",
      });
    });
  });

  it("records the current reading session before switching to another material", async () => {
    mocks.timer.startedAt = "2026-06-12T10:00:00";
    mocks.timer.status = "running";
    mocks.getEnglishReadingMaterialApiMock.mockImplementation(
      async (materialId: number) => {
        if (materialId === 43) {
          return buildMaterial({
            id: 43,
            title: "Napoleon reading material",
            latestVersionId: null,
          });
        }
        return buildMaterial({ id: materialId });
      },
    );
    mocks.getEnglishReadingVersionApiMock.mockImplementation(
      async (materialId: number) => {
        if (materialId === 43) {
          throw new Error("这篇材料还没有生成阅读版本。");
        }
        return buildVersion({ materialId });
      },
    );

    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /打开/i })[1]);

    await waitFor(() => {
      expect(mocks.timer.leaveScene).toHaveBeenCalledWith({
        source: "english_reading_leave",
      });
    });
  });

  it("resets the reading timer only once when a version is loaded", async () => {
    render(
      <MemoryRouter initialEntries={["/english-reading?material=42"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();

    await waitFor(() => {
      expect(mocks.timer.reset).toHaveBeenCalledTimes(1);
    });
    expect(mocks.timer.start).toHaveBeenCalledTimes(1);
  });

  it("renders the final sentence part text instead of stale annotation display text", async () => {
    mocks.generateEnglishReadingVersionApiMock.mockResolvedValue(
      buildVersion({
        renderBlocks: [
          {
            id: "paragraph-1",
            sentences: [
              {
                id: "sentence-1",
                sentenceAnnotationId: "sentence-1-annotation",
                displayText: "Sharper acquisition was stubborn.",
                parts: [
                  { text: "Sharper", spanAnnotationId: "span-1" },
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
            displayText: "Important",
            cefr: "A1",
            resolvedLemma: "important",
            resolutionSource: "dictionary",
          },
          buildVersion().spanAnnotations[1],
          buildVersion().spanAnnotations[2],
        ],
        sentenceAnnotations: [
          {
            id: "sentence-1-annotation",
            kind: "syntax_simplified",
            originalText: "Important acquisition was recalcitrant.",
            displayText: "Sharper acquisition was stubborn.",
            skeletonHints: ["主语", "谓语"],
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/english-reading"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("建立我的 i")).toBeTruthy();
    fireEvent.change(
      screen.getByPlaceholderText(
        "直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。",
      ),
      {
        target: { value: "Important acquisition was recalcitrant." },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "开始定制我的 i+1 材料" }),
    );

    expect(await screen.findByText("Sharper")).toBeTruthy();
  });

  it("allows renaming and deleting a recent material from history", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("Napoleon renamed");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={["/english-reading"]}>
        <EnglishReadingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Napoleon reading material")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    await waitFor(() => {
      expect(mocks.updateEnglishReadingMaterialApiMock).toHaveBeenCalledWith(
        43,
        { title: "Napoleon renamed" },
      );
    });
    expect(await screen.findByText("Napoleon renamed")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    await waitFor(() => {
      expect(mocks.deleteEnglishReadingMaterialApiMock).toHaveBeenCalledWith(
        43,
      );
    });
    expect(screen.queryByText("Napoleon renamed")).toBeNull();

    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });
});
