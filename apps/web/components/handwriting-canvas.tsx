"use client";

import {
  Eraser,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useLanguage } from "@/components/language-provider";

type Point = {
  x: number;
  y: number;
  pressure: number;
};

export type Stroke = {
  points: Point[];
  width: number;
  eraser: boolean;
};

type HandwritingCanvasProps = {
  onChange: (strokes: Stroke[]) => void;
};

export function HandwritingCanvas({ onChange }: HandwritingCanvasProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [width, setWidth] = useState(2.5);
  const [eraser, setEraser] = useState(false);

  const draw = useCallback((allStrokes: Stroke[]) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const stroke of allStrokes) {
      if (stroke.points.length < 2) {
        continue;
      }
      context.save();
      context.globalCompositeOperation = stroke.eraser
        ? "destination-out"
        : "source-over";
      context.strokeStyle = "#1f2833";
      context.lineWidth = stroke.width;
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      context.stroke();
      context.restore();
    }
  }, []);

  useEffect(() => {
    draw(strokes);
  }, [draw, strokes]);

  const pointFromEvent = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x:
        (event.clientX - rect.left) *
        (event.currentTarget.width / Math.max(rect.width, 1)),
      y:
        (event.clientY - rect.top) *
        (event.currentTarget.height / Math.max(rect.height, 1)),
      pressure: event.pressure || 0.5,
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = {
      points: [pointFromEvent(event)],
      width: eraser ? 18 : width,
      eraser,
    };
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current.points.push(pointFromEvent(event));
    draw([...strokes, drawingRef.current]);
  };

  const finishStroke = () => {
    const stroke = drawingRef.current;
    if (!stroke) {
      return;
    }
    drawingRef.current = null;
    const next = [...strokes, stroke];
    setStrokes(next);
    setRedoStack([]);
    onChange(next);
  };

  const undo = () => {
    const last = strokes.at(-1);
    if (!last) {
      return;
    }
    const next = strokes.slice(0, -1);
    setStrokes(next);
    setRedoStack((current) => [...current, last]);
    onChange(next);
  };

  const redo = () => {
    const nextStroke = redoStack.at(-1);
    if (!nextStroke) {
      return;
    }
    const next = [...strokes, nextStroke];
    setStrokes(next);
    setRedoStack((current) => current.slice(0, -1));
    onChange(next);
  };

  const clear = () => {
    if (
      strokes.length > 0 &&
      !window.confirm(t("handwriting.clearConfirm"))
    ) {
      return;
    }
    setStrokes([]);
    setRedoStack([]);
    onChange([]);
  };

  return (
    <div className="handwriting">
      <div
        className="canvas-toolbar"
        aria-label={t("handwriting.tools")}
      >
        <div className="pen-widths">
          <button
            aria-label={t("handwriting.thinPen")}
            className={!eraser && width === 2.5 ? "active" : ""}
            onClick={() => {
              setEraser(false);
              setWidth(2.5);
            }}
            type="button"
          >
            <i className="thin-dot" />
          </button>
          <button
            aria-label={t("handwriting.thickPen")}
            className={!eraser && width === 5 ? "active" : ""}
            onClick={() => {
              setEraser(false);
              setWidth(5);
            }}
            type="button"
          >
            <i className="thick-dot" />
          </button>
          <button
            aria-label={t("handwriting.eraser")}
            className={eraser ? "active" : ""}
            onClick={() => setEraser(true)}
            type="button"
          >
            <Eraser size={17} />
          </button>
        </div>
        <div>
          <button
            aria-label={t("handwriting.undo")}
            disabled={!strokes.length}
            onClick={undo}
            type="button"
          >
            <RotateCcw size={17} />
          </button>
          <button
            aria-label={t("handwriting.redo")}
            disabled={!redoStack.length}
            onClick={redo}
            type="button"
          >
            <RotateCw size={17} />
          </button>
          <button
            aria-label={t("handwriting.clear")}
            onClick={clear}
            type="button"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      <canvas
        aria-label={t("handwriting.area")}
        height={420}
        onPointerCancel={finishStroke}
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={finishStroke}
        ref={canvasRef}
        width={900}
      />
      <p>{t("handwriting.help")}</p>
    </div>
  );
}
