import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMaterial,
  buildVersion,
  mocks,
  renderPage,
  setupEnglishReadingPageTest,
} from "@/features/english-reading/EnglishReadingPage.test-support";

describe("EnglishReadingPage session flows", () => {
  beforeEach(setupEnglishReadingPageTest);

  it("records reading time when leaving the page without manual completion", async () => {
    mocks.timer.startedAt = "2026-06-12T10:00:00";
    mocks.timer.status = "running";

    const view = renderPage(["/english-reading?material=42"]);

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

    renderPage(["/english-reading?material=42"]);

    expect(await screen.findByText("Crucial")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /打开/i })[1]);

    await waitFor(() => {
      expect(mocks.timer.leaveScene).toHaveBeenCalledWith({
        source: "english_reading_leave",
      });
    });
  });

  it("resets the reading timer only once when a version is loaded", async () => {
    renderPage(["/english-reading?material=42"]);

    expect(await screen.findByText("Crucial")).toBeTruthy();

    await waitFor(() => {
      expect(mocks.timer.reset).toHaveBeenCalledTimes(1);
    });
    expect(mocks.timer.start).toHaveBeenCalledTimes(1);
  });
});
