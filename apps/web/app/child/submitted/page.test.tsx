import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SubmittedPage from "./page";

describe("SubmittedPage", () => {
  it("does not expose the results action before hydration", () => {
    const markup = renderToStaticMarkup(<SubmittedPage />);

    expect(markup).toContain("Preparing results");
    expect(markup).toContain('disabled=""');
  });
});
