import { expect, test } from "@playwright/test";
import { addSongs } from "./helpers";

const SERVICES = ["spotify", "apple-music", "youtube-music"];

test("creates the same playlist on all three services", async ({ page, context }) => {
  await context.addCookies(["apple-music", "youtube-music"].map((id) => ({ name: `ts_mock_${id}`, value: "1", url: "http://127.0.0.1:3000" })));
  await page.goto("/api/auth/login");
  await addSongs(page, [
    ["Misery Business", "Paramore"],
    ["Girlfriend", "Avril Lavigne"],
  ]);
  for (const id of SERVICES) await expect(page.getByTestId(`results-tab-${id}`)).toContainText("2");

  await page.getByTestId("to-import").click();
  await expect(page.getByTestId("mode-together")).toHaveAttribute("aria-checked", "true");
  const name = `Everywhere ${Date.now()}`;
  await page.getByTestId("shared-name").fill(name);
  await page.getByTestId("confirm-all").click();

  for (const id of SERVICES) await expect(page.getByTestId(`result-${id}`)).toContainText(`Added 2 songs to “${name}”`);
  await expect(page.locator('[data-testid^="result-"]:not([data-testid^="result-row-"])')).toHaveCount(3);
});

test.describe("without connecting", () => {
  // Anonymous search is rate limited per IP, so this test gets its own address on a reused server.
  test.use({
    permissions: ["clipboard-read", "clipboard-write"],
    extraHTTPHeaders: { "x-forwarded-for": `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` },
  });

  test("matches with search only and copies open.spotify.com links", async ({ page }) => {
    await addSongs(page, [
      ["Misery Business", "Paramore"],
      ["Girlfriend", "Avril Lavigne"],
    ]);
    await expect(page.getByTestId("account-spotify")).toContainText("Search only. Connect to import.");
    await expect(page.getByTestId("match-pill-spotify-1")).toHaveText("Match");
    await expect(page.getByTestId("to-import")).toBeDisabled();

    await page.getByTestId("copy-links-spotify").click();
    await expect(page.getByTestId("no-login-spotify")).toContainText("Copied");
    const links = (await page.evaluate(() => navigator.clipboard.readText())).split("\n");
    expect(links).toEqual(["https://open.spotify.com/track/pmr-misery", "https://open.spotify.com/track/avril-gf"]);
  });
});
