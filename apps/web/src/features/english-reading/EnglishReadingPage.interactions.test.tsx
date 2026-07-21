import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDictionaryEntry,
  mockSentenceSelection,
  mocks,
  renderPage,
  setupEnglishReadingPageTest,
} from "@/features/english-reading/EnglishReadingPage.test-support";

describe("EnglishReadingPage interactions", () => {
  beforeEach(setupEnglishReadingPageTest);

  it("looks up a clicked word, opens the dictionary card, and auto-plays pronunciation", async () => {
    renderPage(["/english/reading/materials/42"]);

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
    renderPage(["/english/reading/materials/42"]);

    const acquisition = await screen.findByRole("button", {
      name: "acquisition",
    });
    fireEvent.click(acquisition);

    const scrollContainer = await screen.findByTestId(
      "dictionary-popup-scroll",
    );
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

    renderPage(["/english/reading/materials/42"]);

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
    renderPage(["/english/reading/materials/42"]);

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
    renderPage(["/english/reading/materials/42"]);

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

    expect(
      await screen.findByTestId("sentence-translation-trigger"),
    ).toBeTruthy();
  });

  it("does not show the translate trigger for invalid or cancelled selections", async () => {
    renderPage(["/english/reading/materials/42"]);

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
    renderPage(["/english/reading/materials/42"]);

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
    renderPage(["/english/reading/materials/42"]);

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
    renderPage(["/english/reading/materials/42"]);

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));

    expect(await screen.findByText("难度变化幅度")).toBeTruthy();
    expect(screen.getByText("0.5 级")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(
        mocks.generateEnglishReadingVersionStreamApiMock,
      ).toHaveBeenLastCalledWith(
        42,
        {
          mode: "regenerate",
          difficultyDirection: "same",
        },
        expect.any(Object),
      );
    });
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith(
      "已重新生成当前内容。",
      undefined,
    );
  });

  it("regenerates with easier direction and selected delta", async () => {
    renderPage(["/english/reading/materials/42"]);

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
        mocks.generateEnglishReadingVersionStreamApiMock,
      ).toHaveBeenLastCalledWith(
        42,
        {
          mode: "regenerate",
          difficultyDirection: "easier",
          difficultyDelta: 1.5,
        },
        expect.any(Object),
      );
    });
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith(
      "已按更简单的难度重新生成。",
      undefined,
    );
  });

  it("regenerates with harder direction", async () => {
    renderPage(["/english/reading/materials/42"]);

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));
    fireEvent.click(screen.getByRole("button", { name: /提升难度/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(
        mocks.generateEnglishReadingVersionStreamApiMock,
      ).toHaveBeenLastCalledWith(
        42,
        {
          mode: "regenerate",
          difficultyDirection: "harder",
          difficultyDelta: 0.5,
        },
        expect.any(Object),
      );
    });
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith(
      "已按更高的难度重新生成。",
      undefined,
    );
  });

  it("keeps regenerate dialog open when regeneration fails", async () => {
    mocks.generateEnglishReadingVersionStreamApiMock.mockRejectedValueOnce(
      new Error("生成失败"),
    );

    renderPage(["/english/reading/materials/42"]);

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新生成内容" }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(mocks.toastErrorMock).toHaveBeenCalledWith("生成失败", undefined);
    });
    expect(screen.getByText("难度变化幅度")).toBeTruthy();
  });
});
