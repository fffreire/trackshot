"use client";

import { useEffect, useRef, useState } from "react";
import { scoreCandidate } from "@/core/match";
import type { CatalogTrack, ProviderId } from "@/core/types";
import {
  access,
  api,
  chosenTracks,
  describeError,
  linksText,
  listText,
  searchPath,
  SERVICES,
  serviceName,
  type Action,
  type Choice,
  type Flow,
  type Remote,
  type ServiceStatus,
} from "./flow";
import { appear, Art, btn, card, describeTrack, Footer, input, Note } from "./ui";

type MatchFlow = Extract<Flow, { stage: "match" }>;

export const LOGIN: Partial<Record<ProviderId, string>> = { spotify: "/api/auth/login", "youtube-music": "/api/auth/youtube/login" };
const LOGOUT: Record<ProviderId, { path: string; method: "POST" | "DELETE" }> = {
  spotify: { path: "/api/auth/logout", method: "POST" },
  "apple-music": { path: "/api/auth/apple-music", method: "DELETE" },
  "youtube-music": { path: "/api/auth/youtube/logout", method: "POST" },
};
const YOUTUBE_LIMIT = "YouTube's API allows about 5–10 screenshots per day per server. Best for self-hosting.";
const STATUS_TEXT = {
  "search-only": "Search only. Connect to import.",
  disconnected: "Not connected",
  "not-configured": "Not configured on this server",
};

export function MatchStep({
  flow,
  services,
  dispatch,
  onToggle,
  onRetry,
  onLeave,
  onServicesChanged,
  onContinue,
}: {
  flow: MatchFlow;
  services: Remote<ServiceStatus[]>;
  dispatch: (action: Action) => void;
  onToggle: (provider: ProviderId) => void;
  onRetry: (provider: ProviderId) => void;
  onLeave: () => void;
  onServicesChanged: () => void;
  onContinue: () => void;
}) {
  const [tab, setTab] = useState<ProviderId>();
  const statuses = services.kind === "ready" ? services.value : [];
  const statusOf = (id: ProviderId) => statuses.find((s) => s.id === id);
  const shown = tab && flow.targets.includes(tab) ? tab : flow.targets[0];
  const importable = flow.targets.filter((id) => {
    const match = flow.matches[id];
    const status = statusOf(id);
    return status && access(status) === "connected" && match?.kind === "ready" && chosenTracks(match.picks).length > 0;
  });

  return (
    <section aria-labelledby="match-title">
      <h1 id="match-title" className="text-[26px] leading-tight font-semibold tracking-tight">
        Where should they go?
      </h1>
      <p className="mt-2 mb-5 text-mute">Pick one or more services. Each one is searched separately, and nothing is added yet.</p>

      <div role="group" aria-label="Destinations" className="flex flex-wrap gap-2">
        {SERVICES.map(({ id, name }) => {
          const status = statusOf(id);
          const usable = status && (access(status) === "connected" || access(status) === "search-only");
          const on = flow.targets.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={!usable}
              data-testid={`service-chip-${id}`}
              onClick={() => onToggle(id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg disabled:cursor-not-allowed disabled:opacity-45 ${
                on ? "border-acc bg-acc text-acc-ink" : "border-line bg-panel text-fg hover:border-fg/40"
              }`}
            >
              {on && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
                  <path d="m5 12 5 5 9-10" />
                </svg>
              )}
              {name}
              {id === "youtube-music" && (
                <span title={YOUTUBE_LIMIT} className={`rounded px-1 text-[10px] font-semibold tracking-wide uppercase ${on ? "bg-acc-ink/10" : "bg-line"}`}>
                  Limited<span className="sr-only">. {YOUTUBE_LIMIT}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={`mt-4 divide-y divide-line ${card}`}>
        {services.kind === "loading" && <p className="px-4 py-3 text-sm text-mute">Checking your connections…</p>}
        {statuses.map((status) => (
          <Account key={status.id} status={status} onLeave={onLeave} onChanged={onServicesChanged} />
        ))}
      </div>

      {flow.targets.length === 0 && services.kind === "ready" && (
        <p className="mt-6 text-sm text-mute">Choose a service above to find your songs there.</p>
      )}

      {flow.targets.length > 1 && (
        <div role="tablist" aria-label="Results by service" className="mt-7 flex gap-1 rounded-xl bg-line/60 p-1">
          {flow.targets.map((id) => {
            const match = flow.matches[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === shown}
                data-testid={`results-tab-${id}`}
                onClick={() => setTab(id)}
                className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-fg ${
                  id === shown ? "bg-panel text-fg shadow-sm" : "text-mute hover:text-fg"
                }`}
              >
                {serviceName(id)}
                {match?.kind === "ready" && <span className="ml-1 text-mute tabular-nums">{chosenTracks(match.picks).length}</span>}
              </button>
            );
          })}
        </div>
      )}

      {shown && (
        <div className={flow.targets.length > 1 ? "mt-4" : "mt-7"} role={flow.targets.length > 1 ? "tabpanel" : undefined}>
          <Results
            provider={shown}
            match={flow.matches[shown]}
            status={statusOf(shown)}
            dispatch={dispatch}
            onRetry={() => onRetry(shown)}
          />
        </div>
      )}

      <Footer>
        <button type="button" className={btn.ghost} onClick={() => dispatch({ type: "back" })}>
          Edit list
        </button>
        <button type="button" className={btn.primary} data-testid="to-import" disabled={!importable.length} onClick={onContinue}>
          {importable.length
            ? `Continue to ${importable.length === 1 ? serviceName(importable[0]) : `${importable.length} services`}`
            : "Connect a service to import"}
        </button>
      </Footer>
    </section>
  );
}

function Account({ status, onLeave, onChanged }: { status: ServiceStatus; onLeave: () => void; onChanged: () => void }) {
  const [byo, setByo] = useState(false);
  const [busy, setBusy] = useState<"idle" | "working" | "failed">("idle");
  const state = access(status);
  const name = serviceName(status.id);
  const login = LOGIN[status.id];

  const apple = useRef<typeof import("@/providers/apple-music-client")>(undefined);
  const prepareApple = status.id === "apple-music" && status.configured && !status.connected;
  useEffect(() => {
    if (!prepareApple) return;
    import("@/providers/apple-music-client")
      .then((client) => {
        apple.current = client;
        return client.prepareAppleMusic();
      })
      .catch(() => {});
  }, [prepareApple]);

  async function connectApple() {
    setBusy("working");
    try {
      await (apple.current ?? (await import("@/providers/apple-music-client"))).connectAppleMusic();
      setBusy("idle");
      onChanged();
    } catch {
      setBusy("failed");
    }
  }

  async function disconnect() {
    setBusy("working");
    const res = await fetch(LOGOUT[status.id].path, { method: LOGOUT[status.id].method }).catch(() => null);
    setBusy(res?.ok ? "idle" : "failed");
    onChanged();
  }

  return (
    <div className="px-4 py-3" data-testid={`account-${status.id}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={`size-2 flex-none rounded-full ${state === "connected" ? "bg-ok" : state === "search-only" ? "bg-warn" : "bg-line"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{name}</p>
          <p className="truncate text-sm text-mute">
            {state === "connected" ? `Connected as ${status.user?.displayName ?? "you"}` : STATUS_TEXT[state]}
          </p>
        </div>
        {state === "connected" && (
          <button type="button" className={btn.small} disabled={busy === "working"} onClick={() => void disconnect()}>
            Disconnect
          </button>
        )}
        {(state === "search-only" || state === "disconnected") &&
          (login ? (
            <a href={login} className={btn.small} data-testid={`connect-${status.id}`} onClick={onLeave}>
              Connect
            </a>
          ) : (
            <button type="button" className={btn.small} data-testid={`connect-${status.id}`} disabled={busy === "working"} onClick={() => void connectApple()}>
              {busy === "working" ? "Connecting…" : "Connect"}
            </button>
          ))}
      </div>
      {status.id === "youtube-music" && state !== "not-configured" && <p className="mt-1 pl-5 text-xs text-mute">Limited: {YOUTUBE_LIMIT}</p>}
      {busy === "failed" && (
        <p className="mt-2 pl-5 text-sm text-bad" role="alert">
          {status.id === "apple-music"
            ? "Couldn't connect Apple Music. If no window opened, allow popups for this site and try again."
            : "That didn't work. Try again."}
        </p>
      )}
      {status.id === "spotify" && state !== "connected" && (
        <div className="mt-2 pl-5">
          <button type="button" className="text-sm text-mute underline decoration-line underline-offset-4 hover:text-fg" aria-expanded={byo} onClick={() => setByo(!byo)}>
            Use your own Spotify app
          </button>
          {byo && (
            <div className={`mt-3 ${appear}`}>
              <ByoSpotify onLeave={onLeave} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ByoSpotify({ onLeave }: { onLeave: () => void }) {
  const [clientId, setClientId] = useState("");
  const valid = /^[0-9a-f]{32}$/i.test(clientId.trim());
  return (
    <div className="text-sm">
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-mute">
        <li>
          Create an app at{" "}
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className={btn.link}>
            developer.spotify.com/dashboard
          </a>
          , with Web API enabled.
        </li>
        <li>
          Add this redirect URI: <code className="rounded bg-bg px-1 py-0.5 text-fg break-all">http://127.0.0.1:3000/api/auth/callback</code>
        </li>
        <li>Copy the app&apos;s Client ID and paste it here.</li>
      </ol>
      <div className="flex gap-2">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Client ID"
          aria-label="Your Spotify Client ID"
          aria-invalid={!!clientId && !valid}
          aria-describedby="byo-hint"
          spellCheck={false}
          autoComplete="off"
          data-testid="byo-client-id"
          className={`${input} font-mono text-sm`}
        />
        {valid ? (
          <a href={`/api/auth/login?clientId=${clientId.trim()}`} onClick={onLeave} className={`${btn.primary} py-2.5`} data-testid="byo-connect">
            Connect
          </a>
        ) : (
          <button type="button" disabled className={`${btn.primary} py-2.5`}>
            Connect
          </button>
        )}
      </div>
      <p id="byo-hint" className={`mt-1.5 ${clientId && !valid ? "text-bad" : "text-mute"}`}>
        {clientId && !valid ? "A Client ID is 32 letters and numbers (0–9, a–f)." : "Only the Client ID is needed, never the secret."}
      </p>
    </div>
  );
}

function Results({
  provider,
  match,
  status,
  dispatch,
  onRetry,
}: {
  provider: ProviderId;
  match: MatchFlow["matches"][ProviderId];
  status?: ServiceStatus;
  dispatch: (action: Action) => void;
  onRetry: () => void;
}) {
  const name = serviceName(provider);
  if (!match || match.kind === "matching")
    return (
      <div aria-busy="true">
        <p className="mb-3 text-sm text-mute" aria-live="polite">
          Searching {name}…
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`mb-2 h-[68px] animate-pulse ${card}`} />
        ))}
      </div>
    );
  if (match.kind === "error")
    return (
      <Note tone="bad">
        <p role="alert">{describeError(match.error, provider)}</p>
        <button type="button" className={`mt-2 ${btn.small}`} onClick={onRetry}>
          Search again
        </button>
      </Note>
    );

  const count = (s: Choice["status"]) => match.picks.filter((p) => p.status === s).length;
  const selected = chosenTracks(match.picks);
  return (
    <div>
      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <span className="text-ok">{count("high")} matched</span>
        {count("ambiguous") > 0 && <span className="text-warn">{count("ambiguous")} to pick</span>}
        {count("unmatched") > 0 && <span className="text-bad">{count("unmatched")} not found</span>}
        <span className="ml-auto text-mute">{selected.length} selected</span>
      </p>
      <ol className="flex flex-col gap-2">
        {match.picks.map((choice, i) => (
          <ChoiceRow key={choice.original.id} provider={provider} index={i} choice={choice} dispatch={dispatch} />
        ))}
      </ol>
      {status && access(status) === "search-only" && <NoLogin provider={provider} tracks={selected} />}
    </div>
  );
}

function ChoiceRow({ provider, index, choice, dispatch }: { provider: ProviderId; index: number; choice: Choice; dispatch: (action: Action) => void }) {
  const name = serviceName(provider);
  const shown = choice.chosen?.track;
  const pill = choice.chosen
    ? choice.status === "high" && choice.chosen === choice.candidates[0]
      ? { text: "Match", tone: "bg-ok-soft text-ok" }
      : { text: "Picked", tone: "bg-line/70 text-fg" }
    : choice.status === "ambiguous"
      ? { text: "Pick one", tone: "bg-warn-soft text-warn" }
      : { text: "Not found", tone: "bg-bad-soft text-bad" };

  const alternatives = (
    <Alternatives provider={provider} index={index} choice={choice} onChoose={(candidate) => dispatch({ type: "choose", provider, index, candidate })} />
  );

  return (
    <li className={`p-3 ${card} ${appear}`} data-testid={`match-row-${provider}-${index}`}>
      <div className="grid grid-cols-[1.25rem_auto_1fr_auto] items-center gap-3">
        <span className="text-right text-sm text-mute tabular-nums">{index + 1}</span>
        <Art track={shown} />
        <div className="min-w-0">
          <p className="truncate font-medium">{shown?.name ?? choice.original.title}</p>
          <p className="truncate text-sm text-mute">
            {shown ? describeTrack(shown) : `${choice.original.artist ?? "Unknown artist"} · ${choice.status === "ambiguous" ? "choose a version below" : "no match"}`}
          </p>
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            checked={choice.included}
            disabled={!choice.chosen}
            aria-label={`Include ${choice.original.title}`}
            data-testid={`include-${provider}-${index}`}
            onChange={(e) => dispatch({ type: "include", provider, index, included: e.target.checked })}
            className="size-5 accent-fg disabled:opacity-30"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-xs text-mute">
        <span className={`rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${pill.tone}`} data-testid={`match-pill-${provider}-${index}`}>
          {pill.text}
        </span>
        {choice.chosen && (
          <details className="group">
            <summary className="cursor-pointer list-none rounded underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-fg">
              score {choice.chosen.score.toFixed(2)}
            </summary>
            <p className="mt-1">
              {choice.chosen.reasons.join(" · ")}. A heuristic for ranking, not a probability.
            </p>
          </details>
        )}
        {choice.chosen && (
          <a href={choice.chosen.track.url} target="_blank" rel="noreferrer" className="rounded underline decoration-line underline-offset-2 hover:text-fg">
            Open in {name}
          </a>
        )}
      </div>

      {choice.status === "ambiguous" && <div className="mt-3 border-t border-line pt-3">{alternatives}</div>}
      {choice.status === "high" && choice.candidates.length > 1 && (
        <details className="mt-1 pl-8 text-xs text-mute">
          <summary className="cursor-pointer rounded hover:text-fg focus-visible:outline-2 focus-visible:outline-fg">
            Not the right one? {choice.candidates.length - 1} other {choice.candidates.length === 2 ? "version" : "versions"}
          </summary>
          <div className="mt-2 -ml-8">{alternatives}</div>
        </details>
      )}
      {choice.status === "unmatched" && (
        <div className="mt-3 border-t border-line pt-3">
          <ManualSearch provider={provider} index={index} choice={choice} dispatch={dispatch} />
          {choice.candidates.length > 0 && <div className="mt-3">{alternatives}</div>}
        </div>
      )}
    </li>
  );
}

function Alternatives({ provider, index, choice, onChoose }: { provider: ProviderId; index: number; choice: Choice; onChoose: (c: Choice["candidates"][number]) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="sr-only">Choose the right version of {choice.original.title}</legend>
      {choice.candidates.map((candidate, j) => {
        const selected = choice.chosen?.track.id === candidate.track.id;
        return (
          <label
            key={candidate.track.id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition has-focus-visible:outline-2 has-focus-visible:outline-fg ${
              selected ? "border-fg bg-bg" : "border-transparent hover:bg-bg"
            }`}
          >
            <input
              type="radio"
              name={`alt-${provider}-${choice.original.id}`}
              checked={selected}
              onChange={() => onChoose(candidate)}
              data-testid={`alt-${provider}-${index}-${j}`}
              className="sr-only"
            />
            <Art track={candidate.track} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{candidate.track.name}</span>
              <span className="block truncate text-xs text-mute">{describeTrack(candidate.track)}</span>
            </span>
            <span className="text-xs text-mute tabular-nums" title={candidate.reasons.join(" · ")}>
              score {candidate.score.toFixed(2)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ManualSearch({ provider, index, choice, dispatch }: { provider: ProviderId; index: number; choice: Choice; dispatch: (action: Action) => void }) {
  const name = serviceName(provider);
  const [query, setQuery] = useState([choice.original.title, choice.original.artist].filter(Boolean).join(" "));
  const [search, setSearch] = useState<"idle" | "searching" | "empty" | { error: string }>("idle");

  async function run() {
    if (!query.trim()) return;
    setSearch("searching");
    const res = await api<{ tracks: CatalogTrack[] }>(searchPath(provider, query.trim(), undefined, "loose"));
    if (!res.ok) return setSearch({ error: describeError(res.error, provider) });
    const candidates = res.data.tracks
      .map((track) => scoreCandidate(choice.original, track))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    setSearch(candidates.length ? "idle" : "empty");
    dispatch({ type: "candidates", provider, index, candidates });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <p className="mb-2 text-xs text-mute">
        {choice.error ? `${choice.error} ` : ""}We read &ldquo;{choice.original.originalText}&rdquo;. Search {name} yourself, or leave it out.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${name} for song ${index + 1}`}
          data-testid={`manual-search-${provider}-${index}`}
          className={`${input} py-2 text-sm`}
        />
        <button type="submit" className={btn.small} disabled={search === "searching"}>
          {search === "searching" ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="mt-1 text-xs text-bad" aria-live="polite">
        {search === "empty" ? "Nothing found. Try fewer words." : typeof search === "object" ? search.error : ""}
      </p>
    </form>
  );
}

function NoLogin({ provider, tracks }: { provider: ProviderId; tracks: CatalogTrack[] }) {
  const name = serviceName(provider);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(linksText(tracks));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([listText(tracks)], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${provider}-songs.txt` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`mt-5 p-4 ${card}`} data-testid={`no-login-${provider}`}>
      <p className="font-medium">Use without connecting</p>
      <p className="mt-1 text-sm text-mute">
        Take the {tracks.length} selected {tracks.length === 1 ? "song" : "songs"} with you, or open each one in {name}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btn.small} disabled={!tracks.length} data-testid={`copy-links-${provider}`} onClick={() => void copy()}>
          Copy links
        </button>
        <button type="button" className={btn.small} disabled={!tracks.length} data-testid={`download-text-${provider}`} onClick={download}>
          Download as text
        </button>
        <span className="self-center text-sm text-mute" aria-live="polite">
          {copied === "copied" ? "Copied" : copied === "failed" ? "Couldn't copy. Try Download instead." : ""}
        </span>
      </div>
      {provider === "spotify" && (
        <p className="mt-3 text-xs text-mute">
          Tip: in the Spotify desktop app, you can usually paste copied song links straight into a playlist with ⌘V / Ctrl+V.
        </p>
      )}
    </div>
  );
}
