import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HandwritingCanvas,
  type Stroke,
} from "@/components/handwriting-canvas";

const initialStrokes: Stroke[] = [
  {
    points: [
      { x: 20, y: 30, pressure: 0.5 },
      { x: 80, y: 90, pressure: 0.5 },
    ],
    width: 2.5,
    eraser: false,
  },
];

describe("HandwritingCanvas", () => {
  beforeEach(() => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getContext",
    ).mockReturnValue(null);
  });

  it("expands right and down without replacing existing strokes", () => {
    const onChange = vi.fn();

    render(
      <HandwritingCanvas
        initialStrokes={initialStrokes}
        onChange={onChange}
      />,
    );

    const canvas = screen.getByLabelText("Handwriting answer area");
    expect(canvas).toHaveAttribute("width", "900");
    expect(canvas).toHaveAttribute("height", "420");

    fireEvent.click(
      screen.getByRole("button", { name: "Add space to the right" }),
    );
    expect(canvas).toHaveAttribute("width", "1200");
    expect(onChange).toHaveBeenLastCalledWith(initialStrokes, {
      width: 1200,
      height: 420,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add space below" }),
    );
    expect(canvas).toHaveAttribute("height", "700");
    expect(onChange).toHaveBeenLastCalledWith(initialStrokes, {
      width: 1200,
      height: 700,
    });
  });

  it("restores a previously saved canvas size", () => {
    render(
      <HandwritingCanvas
        initialSize={{ width: 1500, height: 980 }}
        initialStrokes={initialStrokes}
        onChange={vi.fn()}
      />,
    );

    const canvas = screen.getByLabelText("Handwriting answer area");
    expect(canvas).toHaveAttribute("width", "1500");
    expect(canvas).toHaveAttribute("height", "980");
  });

  it("shows AI annotations over an immutable handwritten answer", () => {
    const onChange = vi.fn();

    const { container } = render(
      <HandwritingCanvas
        annotations={[
          {
            kind: "underline",
            x: 0.68,
            y: 0.54,
            width: 0.21,
            height: 0.08,
            label: "Check these words.",
          },
        ]}
        initialStrokes={initialStrokes}
        onChange={onChange}
        readOnly
      />,
    );

    expect(screen.getByText("Check these words.")).toBeInTheDocument();
    expect(
      container.querySelector('[data-grading-annotation="underline"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear handwriting" }),
    ).toBeDisabled();

    fireEvent.pointerDown(
      screen.getByLabelText("Handwriting answer area"),
      { clientX: 10, clientY: 10, pointerId: 1 },
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
