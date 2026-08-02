import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingDrafts,
  getPendingDraftsByPrefix,
  savePendingDraft,
} from "@/lib/draft-queue";

describe("private draft queue", () => {
  beforeEach(async () => {
    await clearPendingDrafts();
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
});
