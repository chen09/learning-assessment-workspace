import { describe, expect, it } from "vitest";

import {
  getAvailableWordOrderTokens,
  moveWordOrderToken,
  removeWordOrderToken,
} from "@/lib/word-order";

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

describe("word-order answer editing", () => {
  it("moves a selected word in either direction without mutating the saved order", () => {
    const tokens = ["She", "school.", "walks", "to"];

    expect(moveWordOrderToken(tokens, 1, "left")).toEqual([
      "school.",
      "She",
      "walks",
      "to",
    ]);
    expect(moveWordOrderToken(tokens, 1, "right")).toEqual([
      "She",
      "walks",
      "school.",
      "to",
    ]);
    expect(tokens).toEqual(["She", "school.", "walks", "to"]);
  });

  it("keeps duplicate words distinct and ignores moves beyond either edge", () => {
    const tokens = ["I", "I", "agree"];

    expect(moveWordOrderToken(tokens, 0, "left")).toEqual(tokens);
    expect(moveWordOrderToken(tokens, 2, "right")).toEqual(tokens);
    expect(removeWordOrderToken(tokens, 1)).toEqual(["I", "agree"]);
  });
});
