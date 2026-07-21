import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildVersion,
  mocks,
  renderPage,
  setupEnglishReadingPageTest,
} from "@/features/english-reading/EnglishReadingPage.test-support";

describe("EnglishReadingPage core flows", () => {
  beforeEach(setupEnglishReadingPageTest);

  it("creates i+1 material and expands the original sentence skeleton on click", async () => {
    renderPage();

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
    expect(mocks.generateEnglishReadingVersionStreamApiMock).toHaveBeenCalledWith(
      42,
      { mode: "initial" },
      expect.any(Object),
    );

    expect(await screen.findByText("Crucial")).toBeTruthy();
    expect(screen.getByText("acquisition")).toBeTruthy();
    expect(screen.getByText("stubborn")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开原句" }));

    expect(await screen.findByText("原句骨架")).toBeTruthy();
    expect(
      screen.getAllByText("Important acquisition was recalcitrant.").length,
    ).toBeGreaterThan(0);
    expect(mocks.timer.start).not.toHaveBeenCalled();
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith("i+1 阅读材料已生成。", undefined);
  });

  it("shows simplified hover metadata with CEFR, lemma, and source label", async () => {
    renderPage(["/english/reading/materials/42"]);

    const acquisition = await screen.findByText("acquisition");
    fireEvent.mouseEnter(acquisition);

    expect(await screen.findByText("B2:acquisition")).toBeTruthy();
    expect(screen.getByText("还原：acquire")).toBeTruthy();
    expect(screen.getAllByText("标记：词典").length).toBeGreaterThan(0);
  });

  it("accepts drag-and-drop file upload and uses the dropped file as the active source", async () => {
    renderPage();

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
    renderPage();

    expect(await screen.findByText("Napoleon reading material")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /打开/i })[1]);

    await waitFor(() => {
      expect(mocks.getEnglishReadingMaterialApiMock).toHaveBeenCalledWith(43);
      expect(mocks.getEnglishReadingVersionApiMock).toHaveBeenCalledWith(43);
    });
  });

  it("renders the final sentence part text instead of stale annotation display text", async () => {
    const baseVersion = buildVersion();
    mocks.generateEnglishReadingVersionStreamApiMock.mockResolvedValue(
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
            originalCefr: "A1",
            finalCefr: "A1",
            rewriteNeeded: false,
            rewriteDecision: "kept_original",
            resolvedLemma: "important",
            resolutionSource: "dictionary",
          },
          baseVersion.spanAnnotations[1],
          baseVersion.spanAnnotations[2],
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

    renderPage();

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

    renderPage();

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
