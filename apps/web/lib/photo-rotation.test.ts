import { afterEach, describe, expect, it, vi } from "vitest";

import { rotateAnswerImage } from "@/lib/photo-rotation";

describe("rotateAnswerImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a clockwise private-upload candidate without changing its source", async () => {
    const translate = vi.fn();
    const rotate = vi.fn();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      rotate,
      translate,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["rotated"], { type: "image/png" })),
    );

    class FakeImage {
      naturalHeight = 240;
      naturalWidth = 160;
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
      createObjectURL: vi.fn(() => "blob:rotating-source"),
      revokeObjectURL: vi.fn(),
    });

    const rotated = await rotateAnswerImage(
      "https://storage.example.test/signed/original",
      "worksheet-page.jpg",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.test/signed/original",
    );
    expect(rotated.name).toBe("worksheet-page-rotated-90.png");
    expect(rotated.type).toBe("image/png");
    expect(translate).toHaveBeenCalledWith(240, 0);
    expect(rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:rotating-source");
  });
});
