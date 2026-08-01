export type CropBounds = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function croppedFilename(filename: string, mediaType: string) {
  const extension = mediaType === "image/png" ? ".png" : ".jpg";
  const stem = filename.replace(/\.[^/.]+$/, "") || "answer";
  return `${stem}-cropped${extension}`;
}

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("answer_photo_cannot_be_loaded"));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, mediaType: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("answer_photo_cannot_be_cropped"));
      },
      mediaType,
      0.92,
    );
  });
}

function clampBounds(bounds: CropBounds): CropBounds {
  const clamp = (value: number) => Math.min(0.4, Math.max(0, value));
  const top = clamp(bounds.top);
  const bottom = clamp(bounds.bottom);
  const left = clamp(bounds.left);
  const right = clamp(bounds.right);
  if (top + bottom >= 0.8 || left + right >= 0.8) {
    throw new Error("answer_photo_crop_too_small");
  }
  return { top, right, bottom, left };
}

/**
 * Create a cropped response page as a new file. The caller uploads this file
 * to a fresh private response path, leaving the source photo untouched.
 */
export async function cropAnswerImage(
  sourceUrl: string,
  originalFilename: string,
  bounds: CropBounds,
): Promise<File> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("answer_photo_cannot_be_loaded");
  }
  const sourceBlob = await response.blob();
  const sourceObjectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await imageFromUrl(sourceObjectUrl);
    const safeBounds = clampBounds(bounds);
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const cropX = Math.round(sourceWidth * safeBounds.left);
    const cropY = Math.round(sourceHeight * safeBounds.top);
    const cropWidth = Math.round(
      sourceWidth * (1 - safeBounds.left - safeBounds.right),
    );
    const cropHeight = Math.round(
      sourceHeight * (1 - safeBounds.top - safeBounds.bottom),
    );
    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const context = canvas.getContext("2d");
    if (!context || cropWidth <= 0 || cropHeight <= 0) {
      throw new Error("answer_photo_cannot_be_cropped");
    }
    context.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );
    const mediaType = sourceBlob.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await canvasBlob(canvas, mediaType);
    return new File([blob], croppedFilename(originalFilename, mediaType), {
      type: mediaType,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceObjectUrl);
  }
}
