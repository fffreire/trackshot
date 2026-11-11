import { expect, test } from "@playwright/test";
import { acceptanceList } from "../src/core/fixtures/spotify-search";

test("reads the SPEC section 13 TikTok screenshot into 10 songs, in order, on this device", async ({ page }) => {
  test.setTimeout(120_000);
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));

  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles("e2e/fixtures/poppunk-2007.png");
  await expect(page.getByRole("heading", { name: "10 songs" })).toBeVisible({ timeout: 90_000 });

  for (const [i, { title, artist }] of acceptanceList.entries()) {
    await expect(page.getByTestId(`row-title-${i}`)).toHaveValue(title);
    await expect(page.getByTestId(`row-artist-${i}`)).toHaveValue(artist ?? "");
  }
  await expect(page.getByTestId("row-title-10")).toHaveCount(0);
  expect([...hosts].filter((host) => host && host !== "127.0.0.1:3000")).toEqual([]);
});
