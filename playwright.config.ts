import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://127.0.0.1:3000" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testMatch: /(acceptance|import)\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- -H 127.0.0.1 -p 3000",
    url: "http://127.0.0.1:3000",
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { MOCK_PROVIDERS: "1", APP_URL: "http://127.0.0.1:3000", SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e!" },
  },
});
