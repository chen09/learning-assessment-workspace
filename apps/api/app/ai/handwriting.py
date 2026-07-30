from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


def _point(value: object) -> tuple[float, float] | None:
    if isinstance(value, dict):
        x = value.get("x")
        y = value.get("y")
    elif isinstance(value, list) and len(value) >= 2:
        x, y = value[:2]
    else:
        return None
    if not isinstance(x, int | float) or not isinstance(y, int | float):
        return None
    return float(x), float(y)


def _canvas_size(answer: dict[str, Any]) -> tuple[int, int]:
    raw_size = answer.get("canvas_size")
    if not isinstance(raw_size, dict):
        return 1200, 700
    width = raw_size.get("width")
    height = raw_size.get("height")
    if not isinstance(width, int | float) or not isinstance(height, int | float):
        return 1200, 700
    return max(320, min(2400, int(width))), max(240, min(3200, int(height)))


def render_strokes_png(
    answer: dict[str, Any],
    destination: Path,
) -> Path:
    """Render browser pointer strokes to an isolated PNG for visual grading."""

    width, height = _canvas_size(answer)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    raw_strokes = answer.get("strokes")
    strokes = raw_strokes if isinstance(raw_strokes, list) else []
    for raw_stroke in strokes:
        if not isinstance(raw_stroke, dict):
            continue
        raw_points = raw_stroke.get("points")
        if not isinstance(raw_points, list):
            continue
        points = [
            point
            for point in (_point(raw_point) for raw_point in raw_points)
            if point is not None
        ]
        if not points:
            continue
        raw_width = raw_stroke.get("width", 2.5)
        stroke_width = (
            max(1, min(40, round(float(raw_width))))
            if isinstance(raw_width, int | float)
            else 3
        )
        color = "white" if raw_stroke.get("eraser") is True else "#1f2933"
        if len(points) == 1:
            x, y = points[0]
            radius = stroke_width / 2
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=color,
            )
        else:
            draw.line(points, fill=color, width=stroke_width, joint="curve")
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG", optimize=True)
    return destination
