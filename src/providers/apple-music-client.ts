type MusicKit = {
  configure(options: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<{ authorize(): Promise<string> }>;
};

declare global {
  interface Window {
    MusicKit?: MusicKit;
  }
}

let musicKit: Promise<MusicKit> | undefined;

export async function connectAppleMusic() {
  const res = await fetch("/api/auth/apple-music/token");
  if (!res.ok) throw new Error("Apple Music is not available right now");
  const { developerToken } = (await res.json()) as { developerToken: string };

  musicKit ??= new Promise<MusicKit>((resolve, reject) => {
    if (window.MusicKit) return resolve(window.MusicKit);
    document.addEventListener("musickitloaded", () => (window.MusicKit ? resolve(window.MusicKit) : reject()), {
      once: true,
    });
    const script = document.createElement("script");
    script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
    script.async = true;
    script.onerror = () => reject();
    document.head.append(script);
  }).catch(() => {
    musicKit = undefined;
    throw new Error("Could not load Apple MusicKit");
  });

  const music = await (await musicKit).configure({ developerToken, app: { name: "snap2spotify", build: "1.0.0" } });
  const userToken = await music.authorize();
  const saved = await fetch("/api/auth/apple-music", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userToken }),
  });
  if (!saved.ok) throw new Error("Could not connect Apple Music");
}
