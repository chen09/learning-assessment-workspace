import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveAttemptResponse: vi.fn(),
}));

vi.mock("@/lib/api-client", () => mocks);

import {
  clearPendingDrafts,
  getPendingDraftsByPrefix,
  savePendingDraft,
  syncPendingDrafts,
} from "@/lib/draft-queue";

describe("private draft queue", () => {
  beforeEach(async () => {
    await clearPendingDrafts();
    mocks.saveAttemptResponse.mockReset();
  });

  it("restores the pending answers for only the reopened attempt", async () => {
    await savePendingDraft("attempt-a:question-1", { text: "goes" });
    await savePendingDraft("attempt-b:question-1", { text: "walks" });

    await expect(getPendingDraftsByPrefix("attempt-a:")).resolves.toEqual([
      expect.objectContaining({
        key: "attempt-a:question-1",
        answer: { text: "goes" },
      }),
    ]);
  });

  it("does not restore an expired device-only answer", async () => {
    await savePendingDraft("attempt-a:question-1", { text: "goes" });

    await expect(
      getPendingDraftsByPrefix("attempt-a:", new Date("2099-01-01T00:00:00Z")),
    ).resolves.toEqual([]);
  });

  it("drops an expired answer instead of sending it when the device reconnects", async () => {
    await savePendingDraft("attempt-a:question-1", { text: "goes" }, {
      attemptId: "attempt-a",
      questionId: "question-1",
      payload: {
        kind: "text",
        answer: { text: "goes" },
        expected_version: 0,
      },
    });

    await expect(
      syncPendingDrafts("child-token", new Date("2099-01-01T00:00:00Z")),
    ).resolves.toBe(0);
    expect(mocks.saveAttemptResponse).not.toHaveBeenCalled();
    await expect(getPendingDraftsByPrefix("attempt-a:")).resolves.toEqual([]);
  });
});
