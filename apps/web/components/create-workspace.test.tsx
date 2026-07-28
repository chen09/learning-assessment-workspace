import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreateWorkspace } from "@/components/create-workspace";

describe("CreateWorkspace", () => {
  it("keeps imported material in a reviewable draft until the parent confirms", () => {
    render(<CreateWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "Import material" }));
    fireEvent.change(screen.getByLabelText("Learning material"), {
      target: {
        files: [
          new File(["worksheet"], "english-lesson.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    expect(screen.getByText("english-lesson.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create review draft" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Create review draft" }));

    expect(
      screen.getByRole("heading", { name: "Review before assigning" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft · not visible to children")).toBeInTheDocument();
  });
});
