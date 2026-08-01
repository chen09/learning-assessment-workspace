function rotatedFilename(filename: string, mediaType: string) {
  const extension = mediaType === "image/png" ? ".png" : ".jpg";
  const stem = filename.replace(/\.[^/.]+$/, "") || "answer";
  return `${stem}-rotated-90${extension}`;
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
        reject(new Error("answer_photo_cannot_be_rotated"));
      },
      mediaType,
      0.92,
    );
  });
}

/**
 * Create a new, clockwise-rotated photo without modifying its source object.
 * Fetching to a local Blob first keeps private signed-image URLs from tainting
 * the canvas, so the returned File can be uploaded as a separate response page.
 */
export async function rotateAnswerImage(
  sourceUrl: string,
  originalFilename: string,
): Promise<File> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error("answer_photo_cannot_be_loaded");
  }
  const sourceBlob = await response.blob();
  const sourceObjectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await imageFromUrl(sourceObjectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalHeight;
    canvas.height = image.naturalWidth;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) {
      throw new Error("answer_photo_cannot_be_rotated");
    }
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
    context.drawImage(image, 0, 0);

    const mediaType = sourceBlob.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await canvasBlob(canvas, mediaType);
    return new File([blob], rotatedFilename(originalFilename, mediaType), {
      type: mediaType,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceObjectUrl);
  }
}
