import { describe, expect, it } from "vitest";

import { getAvailableWordOrderTokens } from "@/lib/word-order";

describe("getAvailableWordOrderTokens", () => {
  it("keeps a duplicate token available until every occurrence is used", () => {
    const options = ["I", "because", "I", "."];

    expect(getAvailableWordOrderTokens(options, ["I"])).toEqual([
      "because",
      "I",
      ".",
    ]);
    expect(getAvailableWordOrderTokens(options, ["I", "I"])).toEqual([
      "because",
      ".",
    ]);
  });
});
