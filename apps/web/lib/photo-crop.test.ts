import { afterEach, describe, expect, it, vi } from "vitest";

import { cropAnswerImage } from "@/lib/photo-crop";

describe("cropAnswerImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a cropped upload candidate without modifying its source", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["cropped"], { type: "image/png" })),
    );

    class FakeImage {
      naturalHeight = 300;
      naturalWidth = 200;
      onerror: ((event: Event | string) => void) | null = null;
      onload: ((event: Event) => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.(new Event("load")));
      }
    }

    const fetchMock = vi.fn().mockResolvedValue({
      blob: async () => new Blob(["source"], { type: "image/png" }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:cropping-source"),
      revokeObjectURL: vi.fn(),
    });

    const cropped = await cropAnswerImage(
      "https://storage.example.test/signed/original",
      "worksheet-page.jpg",
      { top: 0.1, right: 0.2, bottom: 0.1, left: 0.1 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.test/signed/original",
    );
    expect(cropped.name).toBe("worksheet-page-cropped.png");
    expect(cropped.type).toBe("image/png");
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(FakeImage),
      20,
      30,
      140,
      240,
      0,
      0,
      140,
      240,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cropping-source");
  });
});
