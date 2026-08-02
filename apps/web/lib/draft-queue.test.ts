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

  it("reports the server response version after reconnecting a draft", async () => {
    const request = {
      attemptId: "attempt-a",
      questionId: "question-1",
      payload: {
        kind: "text" as const,
        answer: { text: "goes" },
        expected_version: 0,
      },
    };
    await savePendingDraft("attempt-a:question-1", { text: "goes" }, request);
    mocks.saveAttemptResponse.mockResolvedValue({ version: 4 });
    const onSynced = vi.fn();

    await expect(
      syncPendingDrafts("child-token", undefined, onSynced),
    ).resolves.toBe(1);

    expect(onSynced).toHaveBeenCalledWith(request, 4);
  });

  it("reports a rejected draft without discarding it", async () => {
    const request = {
      attemptId: "attempt-a",
      questionId: "question-1",
      payload: {
        kind: "text" as const,
        answer: { text: "goes" },
        expected_version: 0,
      },
    };
    await savePendingDraft("attempt-a:question-1", { text: "goes" }, request);
    const conflict = new Error('{"detail":{"code":"response_version_conflict"}}');
    mocks.saveAttemptResponse.mockRejectedValue(conflict);
    const onRejected = vi.fn();

    await expect(
      syncPendingDrafts("child-token", undefined, undefined, onRejected),
    ).resolves.toBe(0);

    expect(onRejected).toHaveBeenCalledWith(request, conflict);
    await expect(getPendingDraftsByPrefix("attempt-a:")).resolves.toHaveLength(1);
  });
});
