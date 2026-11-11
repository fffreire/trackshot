import { expect, test } from "@playwright/test";
import { addSongs, choosePlaylist, createPlaylist, trackIds } from "./helpers";

test("imports into an existing Spotify playlist in screenshot order, skipping what's already there", async ({ page }, testInfo) => {
  await addSongs(page, [
    ["Thnks fr th Mmrs", "Fall Out Boy"],
    ["Hey There Delilah", "Plain White T's"],
    ["Misery Business", "Paramore"],
    ["Song That Does Not Exist", "Nobody"],
    ["Girlfriend", "Avril Lavigne"],
  ]);
  await expect(page.getByTestId("account-spotify")).toContainText("Search only");
  await page.getByTestId("connect-spotify").click();
  await expect(page.getByTestId("account-spotify")).toContainText("Connected as E2E User");

  await expect(page.getByTestId("match-pill-spotify-1")).toHaveText("Pick one");
  await expect(page.getByTestId("include-spotify-1")).not.toBeChecked();
  await expect(page.getByTestId("include-spotify-1")).toBeDisabled();
  await page.getByTestId("alt-spotify-1-1").locator("..").click();
  await expect(page.getByTestId("match-pill-spotify-1")).toHaveText("Picked");
  await expect(page.getByTestId("include-spotify-1")).toBeChecked();
  await expect(page.getByTestId("match-pill-spotify-3")).toHaveText("Not found");

  const name = `Pop Punk 2007 ${testInfo.project.name} ${Date.now()}`;
  const playlistId = await createPlaylist(page, name, ["fob-mmrs"]);
  await page.getByTestId("to-import").click();
  await choosePlaylist(page, name);
  await expect(page.getByTestId("skip-duplicates-spotify")).toBeChecked();
  await expect(page.getByTestId("service-card-spotify")).toContainText("1 song already in this playlist will be skipped");
  expect(await trackIds(page, playlistId)).toEqual(["fob-mmrs"]);

  await page.getByTestId("confirm-spotify").click();
  await expect(page.getByTestId("result-spotify")).toContainText(`Added 3 songs to “${name}”`);
  const rows = ["Already there", "Added", "Added", "Not imported", "Added"];
  for (const [i, status] of rows.entries()) await expect(page.getByTestId(`result-row-spotify-${i}`)).toContainText(status);
  expect(await trackIds(page, playlistId)).toEqual(["fob-mmrs", "pwt-delilah-2006", "pmr-misery", "avril-gf"]);
});
