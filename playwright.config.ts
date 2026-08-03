import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = "http://127.0.0.1:3107";
const apiBaseUrl = "http://127.0.0.1:8017";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "auth-route.spec.ts",
    "postgres-flow.spec.ts",
    "hosted-flow.spec.ts",
  ],
  // The fixture API has one shared job queue. Keep each project's flows in
  // source order so one test cannot consume another test's grading job. Next's
  // development server also serves one shared on-demand chunk cache, so the
  // cross-project touch suites must not race its initial compilation.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webBaseUrl,
    // The functional flows deliberately run without a retained service-worker
    // cache. PWA installation/cache behavior has a separate concern; sharing
    // a cache between end-to-end scenarios can mask current-page regressions.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      // Chrome on iPad uses WebKit, which cannot run through local Chrome.
      // This still exercises the handwriting flow with iPad viewport, touch
      // input and scale in our Chromium E2E environment.
      name: "ipad-chrome",
      testMatch: "core-flow.spec.ts",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      // iPad Chrome is required by Apple to use WebKit. Keep this separate
      // from the Chromium touch simulation so a WebKit regression cannot hide
      // behind the desktop browser engine.
      name: "ipad-webkit",
      testMatch: "core-flow.spec.ts",
      grep:
        /(parent creation reaches child grading and correction through the API|parent previews an AI JSON file before assigning its structured questions|parent validates a local-AI completed-paper review before submitting it|listening audio stays private until a child starts an allowed playback|a child can correct a word-order answer in place without resetting it|a child can correct a word-order review in place)/,
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
    },
  ],
  webServer: [
    {
      command:
        "uv run --directory apps/api uvicorn app.main:app --host 127.0.0.1 --port 8017",
      url: `${apiBaseUrl}/healthz`,
      env: {
        APP_ENV: "test",
        CHILD_SESSION_SECRET: "playwright-local-session-secret-only",
        CORS_ORIGINS: JSON.stringify([webBaseUrl]),
        LIBRARY_REVIEWER_PARENT_IDS: JSON.stringify(["parent-fixture"]),
        REPOSITORY_BACKEND: "memory",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "npm run build --workspace @learning-assessment/web && python3 -m http.server 3107 --directory apps/web/out",
      url: webBaseUrl,
      env: {
        NEXT_PUBLIC_API_URL: apiBaseUrl,
        NEXT_PUBLIC_E2E_PARENT_TOKEN: "parent-fixture",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
