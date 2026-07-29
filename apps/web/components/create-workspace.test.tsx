import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreateWorkspace } from "@/components/create-workspace";

describe("CreateWorkspace", () => {
  it("keeps question material and its private answer key separate", () => {
    render(<CreateWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: "Import material" }));
    expect(
      screen.getByRole("radio", {
        name: "Generate new questions from textbook or exercises",
      }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "Convert an existing worksheet into questions",
      }),
    );
    expect(
      screen.getByRole("radio", {
        name: "Convert an existing worksheet into questions",
      }),
    ).toBeChecked();
    fireEvent.change(screen.getByLabelText("Question material"), {
      target: {
        files: [
          new File(["worksheet"], "english-lesson.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("Answer key (private)"), {
      target: {
        files: [
          new File(["answers"], "english-lesson-answers.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    expect(screen.getByText("english-lesson.pdf")).toBeInTheDocument();
    expect(screen.getByText("english-lesson-answers.pdf")).toBeInTheDocument();
    expect(
      screen.getByText("Children never receive this file."),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Original material or examples (optional)"),
    ).toBeInTheDocument();
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
