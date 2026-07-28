import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChildResultsPage from "./page";

describe("ChildResultsPage", () => {
  it("does not expose the correction action before hydration", () => {
    const markup = renderToStaticMarkup(<ChildResultsPage />);

    expect(markup).toContain("Preparing corrections");
    expect(markup).toContain('disabled=""');
  });
});
