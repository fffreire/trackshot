import { expect, type Page } from "@playwright/test";

export async function addSongs(page: Page, songs: [title: string, artist: string][]) {
  await page.goto("/");
  await page.getByTestId("add-manually").click();
  for (const [i, [title, artist]] of songs.entries()) {
    if (i) await page.getByTestId("add-row").click();
    await page.getByTestId(`row-title-${i}`).fill(title);
    await page.getByTestId(`row-artist-${i}`).fill(artist);
  }
  await page.getByTestId("find-matches").click();
}

export async function trackIds(page: Page, playlistId: string): Promise<string[]> {
  const res = await page.request.get(`/api/music/spotify/playlists/${playlistId}/track-ids`);
  expect(res.ok()).toBe(true);
  return (await res.json()).trackIds;
}

/** A fresh Spotify playlist per test, since the mock server's playlists are shared by every test. */
export async function createPlaylist(page: Page, name: string, seed: string[] = []): Promise<string> {
  const res = await page.request.post("/api/music/spotify/playlists", { data: { name } });
  expect(res.ok()).toBe(true);
  const { playlist } = await res.json();
  if (seed.length)
    expect((await page.request.post(`/api/music/spotify/playlists/${playlist.id}/tracks`, { data: { trackIds: seed, requestId: crypto.randomUUID() } })).ok()).toBe(true);
  return playlist.id;
}

export async function choosePlaylist(page: Page, name: string) {
  await page.getByTestId("playlist-select-spotify").click();
  await page.getByTestId("playlist-select-spotify-filter").fill(name);
  await page.getByRole("option", { name }).click();
  await expect(page.getByTestId("playlist-select-spotify")).toContainText(name);
}
