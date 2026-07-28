import { defineConfig, devices } from "@playwright/test";

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the PostgreSQL browser flow.`);
  }
  return value;
}

const webBaseUrl = "http://127.0.0.1:3108";
const apiBaseUrl = "http://127.0.0.1:8018";
const databaseUrl = requiredEnvironment("TEST_DATABASE_URL");
const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const publishableKey = requiredEnvironment("SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "postgres-flow.spec.ts",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webBaseUrl,
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "postgres-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "uv run --directory apps/api python scripts/run_e2e_stack.py",
      url: `${apiBaseUrl}/healthz`,
      env: {
        AI_PROVIDER: "fixture",
        APP_ENV: "test",
        CHILD_SESSION_SECRET: "postgres-playwright-session-secret",
        CORS_ORIGINS: JSON.stringify([webBaseUrl]),
        DATABASE_URL: databaseUrl,
        E2E_API_PORT: "8018",
        REPOSITORY_BACKEND: "postgres",
        SUPABASE_PUBLISHABLE_KEY: publishableKey,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        SUPABASE_URL: supabaseUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "npm run dev --workspace @learning-assessment/web -- --hostname 127.0.0.1 --port 3108",
      url: webBaseUrl,
      env: {
        NEXT_PUBLIC_API_URL: apiBaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
