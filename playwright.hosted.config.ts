import { defineConfig, devices } from "@playwright/test";

const productionHost = "study.hypnochunk.com";

if (process.env.HOSTED_E2E_CONFIRM !== productionHost) {
  throw new Error(
    `Refusing to run hosted E2E without HOSTED_E2E_CONFIRM=${productionHost}.`,
  );
}

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error(
    "Hosted E2E requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "hosted-flow.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.HOSTED_WEB_URL ?? `https://${productionHost}`,
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "hosted-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
