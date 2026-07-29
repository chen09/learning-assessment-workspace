import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Cloudflare Pages cache policy", () => {
  it("requires deployed Next.js assets to revalidate", async () => {
    const headers = await readFile(
      join(process.cwd(), "public", "_headers"),
      "utf8",
    );

    expect(headers).toContain("/_next/static/*");
    expect(headers).toContain(
      "Cache-Control: public, max-age=0, must-revalidate",
    );
  });
});
