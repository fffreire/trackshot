import { expect, test } from "@playwright/test";
import { addSongs, choosePlaylist, createPlaylist, trackIds } from "./helpers";

let name = "";
let playlistId = "";

test.beforeEach(async ({ page }) => {
  await page.goto("/api/auth/login");
  name = `Safety ${crypto.randomUUID()}`;
  playlistId = await createPlaylist(page, name);
  await addSongs(page, [
    ["Misery Business", "Paramore"],
    ["Girlfriend", "Avril Lavigne"],
  ]);
  await page.getByTestId("to-import").click();
});

test("adds nothing before confirm, and a double-click imports once", async ({ page }) => {
  await choosePlaylist(page, name);
  expect(await trackIds(page, playlistId)).toEqual([]);

  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/tracks")) posts.push(request.url());
  });
  await page.getByTestId("confirm-spotify").dblclick();
  await expect(page.getByTestId("result-spotify")).toContainText(`Added 2 songs to “${name}”`);
  expect(await trackIds(page, playlistId)).toEqual(["pmr-misery", "avril-gf"]);
  expect(posts).toHaveLength(1);
});

test("a playlist the user can't edit can't be chosen", async ({ page }) => {
  await page.getByTestId("playlist-select-spotify").click();
  await page.getByTestId("playlist-select-spotify-filter").fill("Followed");
  const option = page.getByRole("option", { name: /Followed Playlist/ });
  await expect(option).toHaveAttribute("aria-disabled", "true");
  await expect(option).toContainText("You can't add to this playlist");
  await option.click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("playlist-select-spotify")).not.toContainText("Followed Playlist");
});
