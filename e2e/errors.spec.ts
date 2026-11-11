import { expect, test } from "@playwright/test";

test("explains Spotify Development Mode when the account isn't allowlisted", async ({ page }) => {
  await page.goto("/?auth_error=not-allowlisted");
  await expect(page.getByRole("alert").filter({ hasText: "Development Mode" })).toBeVisible();
  await expect(page.getByTestId("byo-client-id")).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("rejects a file that isn't an image", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles({ name: "songs.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  await expect(page.getByRole("alert").filter({ hasText: "Please upload a PNG, JPEG or WebP image." })).toBeVisible();
  await expect(page.getByTestId("add-manually")).toBeVisible();
});
