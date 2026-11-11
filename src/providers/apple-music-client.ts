import { PRODUCT } from "@/app/brand";

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

type Configured = { authorize(): Promise<string> };
let prepared: Promise<Configured> | undefined;
let ready: Configured | undefined;

/** Fetches the developer token and loads MusicKit ahead of time, so the later click can open Apple's popup right away. */
export function prepareAppleMusic(): Promise<Configured> {
  prepared ??= (async () => {
    const res = await fetch("/api/auth/apple-music/token");
    if (!res.ok) throw new Error("Apple Music is not available right now");
    const { developerToken } = (await res.json()) as { developerToken: string };
    const kit = await new Promise<MusicKit>((resolve, reject) => {
      if (window.MusicKit) return resolve(window.MusicKit);
      document.addEventListener("musickitloaded", () => (window.MusicKit ? resolve(window.MusicKit) : reject()), {
        once: true,
      });
      const script = document.createElement("script");
      script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
      script.async = true;
      script.onerror = () => reject(new Error("Could not load Apple MusicKit"));
      document.head.append(script);
    });
    ready = await kit.configure({ developerToken, app: { name: PRODUCT.name, build: "1.0.0" } });
    return ready;
  })().catch((error: unknown) => {
    prepared = undefined;
    throw error;
  });
  return prepared;
}

/** Call directly from a click handler: when MusicKit is prepared, authorize() runs synchronously so the popup isn't blocked. */
export async function connectAppleMusic() {
  const userToken = await (ready ? ready.authorize() : (await prepareAppleMusic()).authorize());
  const saved = await fetch("/api/auth/apple-music", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userToken }),
  });
  if (!saved.ok) throw new Error("Could not connect Apple Music");
}
