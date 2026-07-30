"use client";

import {
  ArrowDown,
  ArrowRight,
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

export type CanvasSize = {
  width: number;
  height: number;
};

type HandwritingCanvasProps = {
  initialSize?: CanvasSize;
  initialStrokes?: Stroke[];
  onChange: (strokes: Stroke[], size: CanvasSize) => void;
};

const BASE_CANVAS_SIZE: CanvasSize = { width: 900, height: 420 };
const CANVAS_WIDTH_STEP = 300;
const CANVAS_HEIGHT_STEP = 280;
const MAX_CANVAS_SIZE: CanvasSize = { width: 1800, height: 1260 };

function normalizeCanvasSize(size: CanvasSize): CanvasSize {
  return {
    width: Math.min(
      Math.max(size.width, BASE_CANVAS_SIZE.width),
      MAX_CANVAS_SIZE.width,
    ),
    height: Math.min(
      Math.max(size.height, BASE_CANVAS_SIZE.height),
      MAX_CANVAS_SIZE.height,
    ),
  };
}

export function HandwritingCanvas({
  initialSize = BASE_CANVAS_SIZE,
  initialStrokes = [],
  onChange,
}: HandwritingCanvasProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [width, setWidth] = useState(2.5);
  const [eraser, setEraser] = useState(false);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(() =>
    normalizeCanvasSize(initialSize),
  );

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
  }, [canvasSize, draw, strokes]);

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
    onChange(next, canvasSize);
  };

  const undo = () => {
    const last = strokes.at(-1);
    if (!last) {
      return;
    }
    const next = strokes.slice(0, -1);
    setStrokes(next);
    setRedoStack((current) => [...current, last]);
    onChange(next, canvasSize);
  };

  const redo = () => {
    const nextStroke = redoStack.at(-1);
    if (!nextStroke) {
      return;
    }
    const next = [...strokes, nextStroke];
    setStrokes(next);
    setRedoStack((current) => current.slice(0, -1));
    onChange(next, canvasSize);
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
    onChange([], canvasSize);
  };

  const resizeCanvas = (nextSize: CanvasSize) => {
    setCanvasSize(nextSize);
    onChange(strokes, nextSize);
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
            aria-label={t("handwriting.expandRight")}
            disabled={canvasSize.width >= MAX_CANVAS_SIZE.width}
            onClick={() =>
              resizeCanvas({
                ...canvasSize,
                width: Math.min(
                  canvasSize.width + CANVAS_WIDTH_STEP,
                  MAX_CANVAS_SIZE.width,
                ),
              })
            }
            type="button"
          >
            <ArrowRight size={17} />
          </button>
          <button
            aria-label={t("handwriting.expandDown")}
            disabled={canvasSize.height >= MAX_CANVAS_SIZE.height}
            onClick={() =>
              resizeCanvas({
                ...canvasSize,
                height: Math.min(
                  canvasSize.height + CANVAS_HEIGHT_STEP,
                  MAX_CANVAS_SIZE.height,
                ),
              })
            }
            type="button"
          >
            <ArrowDown size={17} />
          </button>
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
      <div className="canvas-scroll">
        <canvas
          aria-label={t("handwriting.area")}
          height={canvasSize.height}
          onPointerCancel={finishStroke}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={finishStroke}
          ref={canvasRef}
          style={{
            height: `${canvasSize.height}px`,
            width: `${(canvasSize.width / BASE_CANVAS_SIZE.width) * 100}%`,
          }}
          width={canvasSize.width}
        />
      </div>
      <p>{t("handwriting.help")}</p>
    </div>
  );
}
