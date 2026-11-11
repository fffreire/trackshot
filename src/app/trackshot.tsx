"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { z } from "zod";
import { parseTracks } from "@/core/extract";
import type { Playlist, ProviderId } from "@/core/types";
import {
  access,
  api,
  authNotice,
  initialState,
  reducer,
  runImport,
  runMatching,
  SERVICES,
  toTracks,
  type Action,
  type Flow,
  type ServiceStatus,
  type Target,
} from "./flow";
import { PRODUCT } from "./brand";
import { ImportStep } from "./import-step";
import { ByoSpotify, MatchStep } from "./match-step";
import { appear, btn, card, Footer, Note } from "./ui";

const RESUME_KEY = "trackshot:resume";
const resumeSchema = z.object({
  rows: z.array(z.object({ id: z.string(), title: z.string(), artist: z.string() })),
  targets: z.array(z.enum(["spotify", "apple-music", "youtube-music"])),
});

const searchable = (services: ServiceStatus[], id: ProviderId) => {
  const status = services.find((s) => s.id === id);
  return !!status && (access(status) === "connected" || access(status) === "search-only");
};

export default function Trackshot() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { flow, notice } = state;
  const services = state.services.kind === "ready" ? state.services.value : [];
  const choosing = useRef<Partial<Record<ProviderId, string>>>({});

  async function loadServices() {
    const res = await api<{ providers: ServiceStatus[] }>("/api/music/status");
    dispatch({ type: "services", services: res.ok ? { kind: "ready", value: res.data.providers } : { kind: "error", error: res.error } });
    return res.ok ? res.data.providers : [];
  }

  useEffect(() => {
    let live = true;
    (async () => {
      const providers = await loadServices();
      if (!live) return;
      const code = new URLSearchParams(location.search).get("auth_error");
      if (code) {
        dispatch({ type: "notice", notice: authNotice(code) });
        history.replaceState(null, "", location.pathname);
      }
      let saved: z.infer<typeof resumeSchema> | undefined;
      try {
        saved = resumeSchema.safeParse(JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null")).data;
        sessionStorage.removeItem(RESUME_KEY);
      } catch {}
      if (!saved?.rows.length) return;
      dispatch({ type: "rows", rows: saved.rows });
      dispatch({ type: "to-match", targets: saved.targets });
      for (const id of saved.targets) if (searchable(providers, id)) void runMatching(id, toTracks(saved.rows), dispatch);
    })();
    return () => {
      live = false;
    };
  }, []);

  const rememberFlow = () => {
    if (flow.stage !== "match" && flow.stage !== "import") return;
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ rows: flow.rows, targets: flow.targets }));
    } catch {}
  };

  function findMatches() {
    if (flow.stage !== "review") return;
    const connected = services.filter((s) => access(s) === "connected").map((s) => s.id);
    const targets = connected.length ? connected : SERVICES.map((s) => s.id).filter((id) => searchable(services, id)).slice(0, 1);
    dispatch({ type: "to-match", targets });
    for (const id of targets) void runMatching(id, toTracks(flow.rows), dispatch);
  }

  function toggleTarget(provider: ProviderId) {
    if (flow.stage !== "match") return;
    dispatch({ type: "toggle-target", provider });
    const match = flow.matches[provider];
    if (!flow.targets.includes(provider) && (!match || match.kind === "error") && searchable(services, provider))
      void runMatching(provider, flow.tracks, dispatch);
  }

  async function loadPlaylists(provider: ProviderId) {
    dispatch({ type: "dest", provider, patch: { playlists: { kind: "loading" } } });
    const res = await api<{ playlists: Playlist[] }>(`/api/music/${provider}/playlists`);
    dispatch({ type: "dest", provider, patch: { playlists: res.ok ? { kind: "ready", value: res.data.playlists } : { kind: "error", error: res.error } } });
  }

  function toImport() {
    if (flow.stage !== "match") return;
    const connected = flow.targets.filter(
      (id) => services.find((s) => s.id === id && access(s) === "connected") && flow.matches[id]?.kind === "ready",
    );
    const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    dispatch({ type: "to-import", connected, name: `${PRODUCT.name} · ${date}` });
    for (const id of connected) void loadPlaylists(id);
  }

  async function choosePlaylist(provider: ProviderId, target: Target) {
    choosing.current[provider] = target.kind === "existing" ? target.playlist.id : undefined;
    dispatch({ type: "dest", provider, patch: { target, existingIds: undefined } });
    if (target.kind !== "existing") return;
    dispatch({ type: "dest", provider, patch: { existingIds: { kind: "loading" } } });
    const res = await api<{ trackIds: string[] }>(`/api/music/${provider}/playlists/${encodeURIComponent(target.playlist.id)}/track-ids`);
    if (choosing.current[provider] !== target.playlist.id) return;
    dispatch({ type: "dest", provider, patch: { existingIds: res.ok ? { kind: "ready", value: res.data.trackIds } : { kind: "error", error: res.error } } });
  }

  function startImport(providers: ProviderId[]) {
    if (flow.stage !== "import") return;
    for (const id of providers) {
      const dest = flow.dests[id];
      const match = flow.matches[id];
      if (!dest || match?.kind !== "ready" || dest.job.kind === "submitting") continue;
      const name = flow.mode === "together" ? flow.sharedName : dest.target.kind === "new" ? dest.target.name : "";
      void runImport(id, dest, match.picks, name, dispatch);
    }
  }

  const step = { upload: 0, review: 1, match: 2, import: 3 }[flow.stage];

  return (
    <div>
      <ol aria-label="Progress" className="mb-7 flex gap-1.5">
        {["Upload", "Review", "Match", "Import"].map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className="flex-1">
            <span className="sr-only">
              {label}
              {i < step ? " (done)" : ""}
            </span>
            <span aria-hidden className={`block h-[3px] rounded-full transition-colors duration-300 ${i <= step ? "bg-fg" : "bg-line"}`} />
          </li>
        ))}
      </ol>

      {notice && (
        <div className={`mb-5 ${appear}`} role="alert">
          <Note tone={notice.tone}>
            <div className="flex items-start gap-3">
              <p className="flex-1">{notice.text}</p>
              <button type="button" className={btn.link} onClick={() => dispatch({ type: "notice" })}>
                Dismiss
              </button>
            </div>
            {notice.byo && (
              <div className="mt-3">
                <ByoSpotify onLeave={rememberFlow} />
              </div>
            )}
          </Note>
        </div>
      )}

      {state.services.kind === "error" && (
        <div className="mb-5">
          <Note tone="warn">
            Couldn&apos;t load your music services. {""}
            <button type="button" className={btn.link} onClick={() => void loadServices()}>
              Try again
            </button>
          </Note>
        </div>
      )}

      {flow.stage === "upload" && <Upload flow={flow} dispatch={dispatch} />}
      {flow.stage === "review" && <Review flow={flow} dispatch={dispatch} ready={state.services.kind === "ready"} onNext={findMatches} />}
      {flow.stage === "match" && (
        <MatchStep
          flow={flow}
          services={state.services}
          dispatch={dispatch}
          onToggle={toggleTarget}
          onRetry={(id) => void runMatching(id, flow.tracks, dispatch)}
          onLeave={rememberFlow}
          onServicesChanged={() => void loadServices()}
          onContinue={toImport}
        />
      )}
      {flow.stage === "import" && (
        <ImportStep
          flow={flow}
          services={services}
          dispatch={dispatch}
          onChoose={(id, target) => void choosePlaylist(id, target)}
          onReloadPlaylists={(id) => void loadPlaylists(id)}
          onImport={startImport}
          onLeave={rememberFlow}
        />
      )}
    </div>
  );
}

function Upload({ flow, dispatch }: { flow: Extract<Flow, { stage: "upload" }>; dispatch: (action: Action) => void }) {
  const [over, setOver] = useState(false);
  const busy = flow.ocr.kind === "reading";

  async function take(file: File | undefined) {
    if (!file || busy) return;
    const { validateImage, readImage } = await import("@/core/ocr");
    const valid = validateImage(file);
    if (!valid.ok) return dispatch({ type: "ocr", ocr: { kind: "error", message: valid.error } });
    if (flow.image) URL.revokeObjectURL(flow.image.url);
    dispatch({ type: "image", image: { url: URL.createObjectURL(file), name: file.name || "Pasted image" } });
    try {
      const tracks = parseTracks(await readImage(file, (pct) => dispatch({ type: "ocr", ocr: { kind: "reading", pct } })));
      if (!tracks.length) return dispatch({ type: "ocr", ocr: { kind: "empty" } });
      dispatch({ type: "rows", rows: tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist ?? "" })) });
    } catch {
      dispatch({ type: "ocr", ocr: { kind: "error", message: "We couldn't read this image. Try a sharper screenshot, or add the songs by hand." } });
    }
  }

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) void take(file);
  });
  useEffect(() => {
    const listener = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, []);

  const manual = (
    <button type="button" className={btn.link} data-testid="add-manually" onClick={() => dispatch({ type: "rows", rows: [] })}>
      Add songs manually
    </button>
  );

  return (
    <section aria-labelledby="upload-title">
      <h1 id="upload-title" className="text-[26px] leading-tight font-semibold tracking-tight text-balance">
        Screenshot any song or list. Get it in your playlist.
      </h1>
      <p className="mt-2 mb-6 text-mute">
        A TikTok list, a Reddit thread, a Shazam result, an Instagram story. The text is read on your device, and the image is never uploaded.
      </p>

      <label
        className={`group relative flex cursor-pointer flex-col items-center rounded-2xl border-[1.5px] border-dashed px-5 py-12 text-center transition-colors focus-within:border-fg ${
          over ? "border-fg bg-acc-soft" : "border-fg/25 bg-panel hover:border-fg/50"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          data-testid="upload-input"
          disabled={busy}
          onChange={(e) => {
            void take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-mute" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="font-medium">
          <span className="sm:hidden">Tap to choose a screenshot</span>
          <span className="max-sm:hidden">Choose a screenshot or drop it here</span>
        </span>
        <span className="mt-1 text-sm text-mute">
          PNG, JPEG or WebP, up to 10 MB<span className="max-sm:hidden"> · or paste with ⌘V / Ctrl+V</span>
        </span>
      </label>

      {flow.image && (
        <div className={`mt-4 flex items-center gap-4 p-3 ${card} ${appear}`}>
          <Image src={flow.image.url} alt="Your screenshot" width={56} height={96} unoptimized className="h-24 w-14 flex-none rounded-lg border border-line object-cover object-top" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{flow.image.name}</p>
            <p className="mt-0.5 text-sm text-mute" aria-live="polite">
              {flow.ocr.kind === "reading" ? `Reading text… ${flow.ocr.pct}%` : flow.ocr.kind === "empty" ? "No songs found" : flow.ocr.kind === "error" ? "Couldn't read it" : ""}
            </p>
            {flow.ocr.kind === "reading" && (
              <div role="progressbar" aria-label="Reading text" aria-valuenow={flow.ocr.pct} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-acc transition-[width] duration-300" style={{ width: `${flow.ocr.pct}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {flow.ocr.kind === "empty" && (
        <div className={`mt-4 ${appear}`}>
          <Note tone="warn">
            We couldn&apos;t find any songs in this image. Try a screenshot where the titles are clearly visible, or {manual}.
          </Note>
        </div>
      )}
      {flow.ocr.kind === "error" && (
        <div className={`mt-4 ${appear}`} role="alert">
          <Note tone="bad">
            {flow.ocr.message} {manual}
          </Note>
        </div>
      )}
      {flow.ocr.kind === "idle" && <p className="mt-5 text-center text-sm text-mute">No screenshot handy? {manual}</p>}
    </section>
  );
}

function Review({
  flow,
  dispatch,
  ready,
  onNext,
}: {
  flow: Extract<Flow, { stage: "review" }>;
  dispatch: (action: Action) => void;
  ready: boolean;
  onNext: () => void;
}) {
  const count = flow.rows.filter((row) => row.title.trim()).length;
  return (
    <section aria-labelledby="review-title">
      <h1 id="review-title" className="text-[26px] leading-tight font-semibold tracking-tight">
        {count ? `${count} ${count === 1 ? "song" : "songs"}` : "Add your songs"}
      </h1>
      <p className="mt-2 mb-6 text-mute">Same order as the screenshot. Fix anything that was read wrong, then find matches.</p>

      <ol className="flex flex-col gap-2">
        {flow.rows.map((row, i) => (
          <li key={row.id} className={`grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 py-2 pr-1.5 pl-3 ${card} ${appear}`}>
            <span className="text-right text-sm text-mute tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <input
                value={row.title}
                placeholder="Song title"
                aria-label={`Title of song ${i + 1}`}
                data-testid={`row-title-${i}`}
                className="w-full rounded-md bg-transparent px-1.5 py-1 font-medium placeholder:text-mute focus:bg-bg focus:outline-none"
                onChange={(e) => dispatch({ type: "edit-row", id: row.id, field: "title", value: e.target.value })}
              />
              <input
                value={row.artist}
                placeholder="Artist (optional)"
                aria-label={`Artist of song ${i + 1}`}
                data-testid={`row-artist-${i}`}
                className="w-full rounded-md bg-transparent px-1.5 py-0.5 text-sm text-mute placeholder:text-mute/70 focus:bg-bg focus:text-fg focus:outline-none"
                onChange={(e) => dispatch({ type: "edit-row", id: row.id, field: "artist", value: e.target.value })}
              />
            </div>
            <button
              type="button"
              aria-label={`Remove song ${i + 1}`}
              data-testid={`row-remove-${i}`}
              className="grid size-9 place-items-center rounded-lg text-mute transition hover:bg-bad-soft hover:text-bad focus-visible:outline-2 focus-visible:outline-fg"
              onClick={() => dispatch({ type: "remove-row", id: row.id })}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        data-testid="add-row"
        className="mt-2 w-full rounded-2xl border border-dashed border-fg/25 px-4 py-3 text-sm font-medium text-mute transition hover:border-fg/50 hover:text-fg focus-visible:outline-2 focus-visible:outline-fg"
        onClick={() => dispatch({ type: "add-row" })}
      >
        + Add a song
      </button>

      <Footer>
        <button type="button" className={btn.ghost} onClick={() => dispatch({ type: "reset" })}>
          Start over
        </button>
        <button type="button" className={btn.primary} data-testid="find-matches" disabled={!count || !ready} onClick={onNext}>
          {count ? `Find ${count} ${count === 1 ? "song" : "songs"}` : "Add at least 1 song"}
        </button>
      </Footer>
    </section>
  );
}
