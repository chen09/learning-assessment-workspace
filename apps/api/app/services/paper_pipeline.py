from dataclasses import dataclass
from pathlib import Path
from typing import cast

import cv2
import numpy as np
from numpy.typing import NDArray
from playwright.async_api import async_playwright
from pypdf import PdfReader

A4_PIXEL_SIZE = (1240, 1754)


@dataclass(frozen=True, slots=True)
class AnswerRegion:
    question_id: str
    x: float
    y: float
    width: float
    height: float

    def __post_init__(self) -> None:
        values = (self.x, self.y, self.width, self.height)
        if any(value < 0 or value > 1 for value in values):
            raise ValueError("Answer region coordinates must be normalized.")
        if self.width == 0 or self.height == 0:
            raise ValueError("Answer regions must have a positive size.")
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Answer region extends beyond the page.")


@dataclass(frozen=True, slots=True)
class CroppedAnswer:
    question_id: str
    jpeg_bytes: bytes


def count_pdf_pages(pdf_bytes: bytes) -> int:
    from io import BytesIO

    return len(PdfReader(BytesIO(pdf_bytes)).pages)


def _ordered_corners(points: NDArray[np.float32]) -> NDArray[np.float32]:
    ordered = np.zeros((4, 2), dtype=np.float32)
    coordinate_sum = points.sum(axis=1)
    coordinate_difference = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[np.argmin(coordinate_sum)]
    ordered[2] = points[np.argmax(coordinate_sum)]
    ordered[1] = points[np.argmin(coordinate_difference)]
    ordered[3] = points[np.argmax(coordinate_difference)]
    return ordered


def normalize_paper_scan(image_bytes: bytes) -> NDArray[np.uint8]:
    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The scan is not a readable PNG or JPEG.")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 160)
    contours, _hierarchy = cv2.findContours(
        edges,
        cv2.RETR_LIST,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    page: NDArray[np.float32] | None = None
    image_area = image.shape[0] * image.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contour) < image_area * 0.2:
            break
        perimeter = cv2.arcLength(contour, True)
        approximate = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approximate) == 4:
            page = approximate.reshape(4, 2).astype(np.float32)
            break

    target_width, target_height = A4_PIXEL_SIZE
    if page is None:
        return cast(
            NDArray[np.uint8],
            cv2.resize(
                image,
                (target_width, target_height),
                interpolation=cv2.INTER_AREA,
            ),
        )

    destination = np.array(
        [
            [0, 0],
            [target_width - 1, 0],
            [target_width - 1, target_height - 1],
            [0, target_height - 1],
        ],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(_ordered_corners(page), destination)
    return cast(
        NDArray[np.uint8],
        cv2.warpPerspective(
            image,
            transform,
            (target_width, target_height),
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(255, 255, 255),
        ),
    )


def split_answer_regions(
    image_bytes: bytes,
    regions: list[AnswerRegion],
) -> list[CroppedAnswer]:
    normalized = normalize_paper_scan(image_bytes)
    page_height, page_width = normalized.shape[:2]
    answers: list[CroppedAnswer] = []
    for region in regions:
        left = round(region.x * page_width)
        top = round(region.y * page_height)
        right = round((region.x + region.width) * page_width)
        bottom = round((region.y + region.height) * page_height)
        crop = normalized[top:bottom, left:right]
        encoded, jpeg = cv2.imencode(
            ".jpg",
            crop,
            [cv2.IMWRITE_JPEG_QUALITY, 90],
        )
        if not encoded:
            raise ValueError(f"Could not encode answer region {region.question_id}.")
        answers.append(
            CroppedAnswer(
                question_id=region.question_id,
                jpeg_bytes=jpeg.tobytes(),
            )
        )
    return answers


class PrintablePdfRenderer:
    def __init__(self, chromium_path: str = "/usr/bin/chromium") -> None:
        self._chromium_path = chromium_path

    async def render(self, html: str, output_path: Path) -> None:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=self._chromium_path,
                headless=True,
            )
            try:
                page = await browser.new_page()
                await page.set_content(html, wait_until="networkidle")
                await page.emulate_media(media="print")
                await page.pdf(
                    path=str(output_path),
                    format="A4",
                    print_background=True,
                    prefer_css_page_size=True,
                )
            finally:
                await browser.close()
