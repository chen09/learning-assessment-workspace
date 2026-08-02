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
import type { GradingAnnotation } from "@/lib/api-client";

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

type ToolbarAction =
  | "request-clear"
  | "keep-handwriting"
  | "clear-immediately";

type HandwritingCanvasProps = {
  annotations?: GradingAnnotation[];
  initialSize?: CanvasSize;
  initialStrokes?: Stroke[];
  onChange: (strokes: Stroke[], size: CanvasSize) => void;
  readOnly?: boolean;
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
  annotations = [],
  initialSize = BASE_CANVAS_SIZE,
  initialStrokes = [],
  onChange,
  readOnly = false,
}: HandwritingCanvasProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [width, setWidth] = useState(2.5);
  const [eraser, setEraser] = useState(false);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const lastTouchActionRef = useRef<{
    action: ToolbarAction;
    at: number;
  } | null>(null);
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
    if (readOnly) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // iPad browsers can reject pointer capture for a finger or stylus.
      // Pointer events still continue to be tracked by drawingRef below.
    }
    drawingRef.current = {
      points: [pointFromEvent(event)],
      width: eraser ? 18 : width,
      eraser,
    };
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (readOnly) {
      return;
    }
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current.points.push(pointFromEvent(event));
    draw([...strokes, drawingRef.current]);
  };

  const finishStroke = () => {
    if (readOnly) {
      drawingRef.current = null;
      return;
    }
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

  const clearImmediately = () => {
    drawingRef.current = null;
    // A touch can leave its current stroke in the ref until pointerup. Clear
    // the bitmap explicitly as well: setting an already-empty React state
    // alone would not trigger a redraw on iPad Chrome.
    draw([]);
    setClearConfirmationOpen(false);
    setStrokes([]);
    setRedoStack([]);
    onChange([], canvasSize);
  };

  const requestClear = () => {
    if (strokes.length > 0 || drawingRef.current) {
      setClearConfirmationOpen(true);
      return;
    }
    clearImmediately();
  };

  const keepHandwriting = () => {
    setClearConfirmationOpen(false);
  };

  const runTouchLikeAction = (
    actionName: ToolbarAction,
    action: () => void,
  ) => {
    const now = Date.now();
    const previousAction = lastTouchActionRef.current;
    if (
      previousAction?.action === actionName &&
      now - previousAction.at < 700
    ) {
      return;
    }
    lastTouchActionRef.current = { action: actionName, at: now };
    action();
  };

  const handleTouchAction = (
    event: React.TouchEvent<HTMLButtonElement>,
    actionName: ToolbarAction,
    action: () => void,
  ) => {
    // On iPad Chrome, a toolbar tap can dispatch touch events without the
    // synthetic click that desktop browsers normally follow with.
    event.preventDefault();
    runTouchLikeAction(actionName, action);
  };

  const handlePointerAction = (
    event: ReactPointerEvent<HTMLButtonElement>,
    actionName: ToolbarAction,
    action: () => void,
  ) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }
    // Some iPad Chrome and Apple Pencil interactions complete with a pointer
    // event but no TouchEvent or synthetic click. Treat it like touch input.
    event.preventDefault();
    runTouchLikeAction(actionName, action);
  };

  const handleClickAction = (
    actionName: ToolbarAction,
    action: () => void,
  ) => {
    // A touchend on iPad can be followed by a synthetic click. Do not run a
    // destructive canvas action twice for one physical tap.
    const previousAction = lastTouchActionRef.current;
    if (
      previousAction?.action === actionName &&
      Date.now() - previousAction.at < 700
    ) {
      return;
    }
    action();
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
            disabled={readOnly}
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
            disabled={readOnly}
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
            disabled={readOnly}
            onClick={() => setEraser(true)}
            type="button"
          >
            <Eraser size={17} />
          </button>
        </div>
        <div>
          <button
            aria-label={t("handwriting.expandRight")}
            disabled={
              readOnly || canvasSize.width >= MAX_CANVAS_SIZE.width
            }
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
            disabled={
              readOnly || canvasSize.height >= MAX_CANVAS_SIZE.height
            }
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
            disabled={readOnly || !strokes.length}
            onClick={undo}
            type="button"
          >
            <RotateCcw size={17} />
          </button>
          <button
            aria-label={t("handwriting.redo")}
            disabled={readOnly || !redoStack.length}
            onClick={redo}
            type="button"
          >
            <RotateCw size={17} />
          </button>
          <button
            aria-label={t("handwriting.clear")}
            disabled={readOnly}
            onClick={() => handleClickAction("request-clear", requestClear)}
            onPointerUp={(event) =>
              handlePointerAction(event, "request-clear", requestClear)
            }
            onTouchEnd={(event) =>
              handleTouchAction(event, "request-clear", requestClear)
            }
            type="button"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      {clearConfirmationOpen ? (
        <div
          aria-label={t("handwriting.clear")}
          className="canvas-clear-confirmation"
          role="alertdialog"
        >
          <p>{t("handwriting.clearConfirm")}</p>
          <div>
            <button
              onClick={() =>
                handleClickAction("keep-handwriting", keepHandwriting)
              }
              onPointerUp={(event) =>
                handlePointerAction(
                  event,
                  "keep-handwriting",
                  keepHandwriting,
                )
              }
              onTouchEnd={(event) =>
                handleTouchAction(
                  event,
                  "keep-handwriting",
                  keepHandwriting,
                )
              }
              type="button"
            >
              {t("handwriting.keep")}
            </button>
            <button
              className="danger"
              onClick={() =>
                handleClickAction("clear-immediately", clearImmediately)
              }
              onPointerUp={(event) =>
                handlePointerAction(
                  event,
                  "clear-immediately",
                  clearImmediately,
                )
              }
              onTouchEnd={(event) =>
                handleTouchAction(
                  event,
                  "clear-immediately",
                  clearImmediately,
                )
              }
              type="button"
            >
              {t("handwriting.clearNow")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="canvas-scroll">
        <div
          className="canvas-stage"
          style={{
            height: `${canvasSize.height}px`,
            width: `${(canvasSize.width / BASE_CANVAS_SIZE.width) * 100}%`,
          }}
        >
          <canvas
            aria-label={t("handwriting.area")}
            aria-readonly={readOnly}
            height={canvasSize.height}
            onPointerCancel={finishStroke}
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={finishStroke}
            ref={canvasRef}
            width={canvasSize.width}
          />
          {annotations.length > 0 ? (
            <svg
              aria-hidden="true"
              className="grading-annotation-layer"
              viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
            >
              {annotations.map((annotation, index) => {
                const x = annotation.x * canvasSize.width;
                const y = annotation.y * canvasSize.height;
                const annotationWidth =
                  annotation.width * canvasSize.width;
                const annotationHeight =
                  annotation.height * canvasSize.height;
                const commonProps = {
                  "data-grading-annotation": annotation.kind,
                  vectorEffect: "non-scaling-stroke" as const,
                };
                if (annotation.kind === "underline") {
                  return (
                    <line
                      {...commonProps}
                      key={`${annotation.kind}-${index}`}
                      x1={x}
                      x2={x + annotationWidth}
                      y1={y + annotationHeight}
                      y2={y + annotationHeight}
                    />
                  );
                }
                if (annotation.kind === "cross") {
                  return (
                    <g
                      data-grading-annotation={annotation.kind}
                      key={`${annotation.kind}-${index}`}
                    >
                      <line
                        vectorEffect="non-scaling-stroke"
                        x1={x}
                        x2={x + annotationWidth}
                        y1={y}
                        y2={y + annotationHeight}
                      />
                      <line
                        vectorEffect="non-scaling-stroke"
                        x1={x + annotationWidth}
                        x2={x}
                        y1={y}
                        y2={y + annotationHeight}
                      />
                    </g>
                  );
                }
                return (
                  <rect
                    {...commonProps}
                    height={annotationHeight}
                    key={`${annotation.kind}-${index}`}
                    rx={8}
                    width={annotationWidth}
                    x={x}
                    y={y}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>
      {annotations.length > 0 ? (
        <ol className="grading-annotation-list">
          {annotations.map((annotation, index) => (
            <li key={`${annotation.kind}-${index}-label`}>
              <span>{index + 1}</span>
              {annotation.label}
            </li>
          ))}
        </ol>
      ) : null}
      <p>{t("handwriting.help")}</p>
    </div>
  );
}
