import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorksheetWorkbench } from "@/components/worksheet-workbench";

describe("WorksheetWorkbench", () => {
  it("autosaves an answer and lets the child move to the next question", async () => {
    render(<WorksheetWorkbench />);

    expect(
      screen.getByRole("heading", {
        name: "Choose the correct expansion of (a + b)(a − b).",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "a² − b²" }));

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));

    expect(
      screen.getByRole("heading", {
        name: "Complete: She ___ to school every day.",
      }),
    ).toBeInTheDocument();
  });
});
