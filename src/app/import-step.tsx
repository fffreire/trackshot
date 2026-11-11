"use client";

import type { ImportOutcome, ProviderId } from "@/core/types";
import {
  describeError,
  plan,
  playlistUrl,
  retryFailed,
  SERVICES,
  serviceName,
  type Action,
  type Choice,
  type Dest,
  type Flow,
  type ImportResult,
  type Mark,
  type ServiceStatus,
  type Target,
} from "./flow";
import { LOGIN } from "./match-step";
import { PlaylistPicker } from "./playlist-picker";
import { appear, Art, btn, card, Footer, input, Note } from "./ui";

type ImportFlow = Extract<Flow, { stage: "import" }>;
type Props = {
  flow: ImportFlow;
  services: ServiceStatus[];
  dispatch: (action: Action) => void;
  onChoose: (provider: ProviderId, target: Target) => void;
  onReloadPlaylists: (provider: ProviderId) => void;
  onImport: (providers: ProviderId[]) => void;
  onLeave: () => void;
};

const NOT_ATTEMPTED = /^not attempted/i;
const markLabel: Record<Mark, string> = { add: "will be added", already: "already there, skipped", out: "not found or not selected" };

const picksOf = (flow: ImportFlow, id: ProviderId): Choice[] => {
  const match = flow.matches[id];
  return match?.kind === "ready" ? match.picks : [];
};
const marksOf = (dest: Dest, picks: Choice[]) =>
  plan(picks, dest.target.kind === "existing" && dest.existingIds?.kind === "ready" ? dest.existingIds.value : [], dest.skipDuplicates);
const checking = (dest: Dest) => dest.target.kind === "existing" && dest.skipDuplicates && dest.existingIds?.kind === "loading";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ImportStep(props: Props) {
  const { flow, dispatch } = props;
  const ids = SERVICES.map((s) => s.id).filter((id) => flow.dests[id]);
  const started = ids.filter((id) => flow.dests[id]?.job.kind !== "idle");
  const together = flow.mode === "together" && ids.length > 1;

  return (
    <section aria-labelledby="import-title">
      <h1 id="import-title" className="text-[26px] leading-tight font-semibold tracking-tight">
        {started.length ? "Import results" : ids.length === 1 ? `Add to ${serviceName(ids[0])}` : "Add to your playlists"}
      </h1>
      <p className="mt-2 mb-5 text-mute">
        {started.length
          ? "Each service is reported on its own. A problem in one never undoes the others."
          : "Songs are added in screenshot order. Nothing already in a playlist is changed, and nothing happens until you confirm."}
      </p>

      {ids.length > 1 && !started.length && (
        <div role="radiogroup" aria-label="Import mode" className="mb-5 flex gap-1 rounded-xl bg-line/60 p-1">
          {(["together", "separate"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={flow.mode === mode}
              data-testid={`mode-${mode}`}
              onClick={() => dispatch({ type: "mode", mode })}
              className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-fg ${
                flow.mode === mode ? "bg-panel text-fg shadow-sm" : "text-mute hover:text-fg"
              }`}
            >
              {mode === "together" ? "Same playlist everywhere" : "Each service separately"}
            </button>
          ))}
        </div>
      )}

      {together && !started.length ? (
        <Together {...props} ids={ids} />
      ) : (
        <div className="flex flex-col gap-4">
          {(together ? started : ids).map((id) =>
            flow.dests[id]?.job.kind === "idle" ? <ServiceCard key={id} {...props} id={id} /> : <ResultCard key={id} {...props} id={id} />,
          )}
          {together && ids.length > started.length && (
            <p className="text-sm text-mute">
              {ids
                .filter((id) => !started.includes(id))
                .map(serviceName)
                .join(" and ")}{" "}
              {ids.length - started.length === 1 ? "was" : "were"} left out.{" "}
              <button type="button" className={btn.link} onClick={() => dispatch({ type: "mode", mode: "separate" })}>
                Import there separately
              </button>
            </p>
          )}
        </div>
      )}

      <Footer>
        {started.length ? (
          <button type="button" className={btn.ghost} data-testid="start-over" onClick={() => dispatch({ type: "reset" })}>
            Start over
          </button>
        ) : (
          <button type="button" className={btn.ghost} onClick={() => dispatch({ type: "back" })}>
            Back to matches
          </button>
        )}
        {together && !started.length && <ConfirmAll {...props} ids={ids} />}
      </Footer>
    </section>
  );
}

function ConfirmAll({ flow, ids, onImport }: Props & { ids: ProviderId[] }) {
  const on = ids.filter((id) => flow.dests[id]?.enabled);
  const dests = on.flatMap((id) => {
    const dest = flow.dests[id];
    return dest ? [{ id, dest, adds: marksOf(dest, picksOf(flow, id)).filter((m) => m === "add").length }] : [];
  });
  const allNew = dests.every((d) => d.dest.target.kind === "new");
  const ready =
    dests.length > 0 &&
    dests.every((d) => d.adds > 0 && !checking(d.dest)) &&
    (!dests.some((d) => d.dest.target.kind === "new") || flow.sharedName.trim().length > 0);
  return (
    <button type="button" className={btn.primary} data-testid="confirm-all" disabled={!ready} onClick={() => onImport(on)}>
      {dests.length ? `${allNew ? "Create in" : "Add to"} ${plural(dests.length, "service")}` : "Choose a service"}
    </button>
  );
}

function Together({ flow, services, dispatch, onChoose, onReloadPlaylists, ids }: Props & { ids: ProviderId[] }) {
  const on = ids.filter((id) => flow.dests[id]?.enabled);
  const marks = Object.fromEntries(on.map((id) => [id, marksOf(flow.dests[id] as Dest, picksOf(flow, id))]));
  return (
    <div className="flex flex-col gap-4">
      <div className={`p-4 ${card}`}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Playlist name</span>
          <input
            value={flow.sharedName}
            data-testid="shared-name"
            onChange={(e) => dispatch({ type: "shared-name", name: e.target.value })}
            className={input}
            maxLength={100}
          />
        </label>
        <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
          {ids.map((id) => {
            const dest = flow.dests[id];
            if (!dest) return null;
            const adds = marksOf(dest, picksOf(flow, id)).filter((m) => m === "add").length;
            return (
              <li key={id} className="py-3.5">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={dest.enabled}
                    data-testid={`dest-toggle-${id}`}
                    onChange={(e) => dispatch({ type: "dest", provider: id, patch: { enabled: e.target.checked } })}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className="relative h-6 w-10 flex-none rounded-full bg-line transition peer-checked:bg-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fg after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-panel after:shadow-sm after:transition peer-checked:after:translate-x-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{serviceName(id)}</span>
                    <span className="block truncate text-sm text-mute">
                      {services.find((s) => s.id === id)?.user?.displayName ?? "Connected"} · {plural(adds, "song")}
                    </span>
                  </span>
                </label>
                {dest.enabled && (
                  <div className={`mt-3 flex flex-col gap-2 ${appear}`}>
                    <PlaylistPicker
                      provider={id}
                      playlists={dest.playlists}
                      value={dest.target}
                      newLabel={flow.sharedName.trim() || "New playlist"}
                      testId={`playlist-select-${id}`}
                      onChange={(picked) => onChoose(id, picked.kind === "new" ? { kind: "new", name: flow.sharedName } : picked)}
                      onRetry={() => onReloadPlaylists(id)}
                    />
                    {dest.target.kind === "existing" && <SkipToggle id={id} dest={dest} dispatch={dispatch} />}
                    {adds === 0 && !checking(dest) && <p className="text-sm text-warn">Nothing to add here. Turn it off, or pick songs on the matches screen.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {on.length > 0 && (
        <div className={card}>
          <div className="flex items-end gap-2 border-b border-line px-4 py-3">
            <p className="flex-1 text-sm font-medium">Preview</p>
            {on.map((id) => (
              <span key={id} className="w-12 text-center text-[11px] leading-tight text-mute">
                {serviceName(id)}
              </span>
            ))}
          </div>
          <ol data-testid="preview-all">
            {flow.tracks.map((track, i) => (
              <li key={track.id} className="flex items-center gap-2 border-b border-line px-4 py-2.5 last:border-0">
                <span className="w-5 flex-none text-right text-sm text-mute tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{track.title}</span>
                  <span className="block truncate text-xs text-mute">{track.artist ?? "Unknown artist"}</span>
                </span>
                {on.map((id) => (
                  <MarkIcon key={id} mark={marks[id][i]} label={`${serviceName(id)}: ${markLabel[marks[id][i]]}`} />
                ))}
              </li>
            ))}
          </ol>
          <p className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs text-mute">
            <span>✓ will be added</span>
            <span>= already there, skipped</span>
            <span>– not found or not selected</span>
          </p>
        </div>
      )}
    </div>
  );
}

function MarkIcon({ mark, label }: { mark: Mark; label: string }) {
  const tone = { add: "bg-ok-soft text-ok", already: "bg-line/70 text-mute", out: "text-mute/60" }[mark];
  return (
    <span className="grid w-12 flex-none place-items-center" title={label}>
      <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${tone}`} aria-label={label} role="img">
        {{ add: "✓", already: "=", out: "–" }[mark]}
      </span>
    </span>
  );
}

function SkipToggle({ id, dest, dispatch }: { id: ProviderId; dest: Dest; dispatch: (action: Action) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 text-sm">
      Skip songs already in this playlist
      <input
        type="checkbox"
        checked={dest.skipDuplicates}
        data-testid={`skip-duplicates-${id}`}
        onChange={(e) => dispatch({ type: "dest", provider: id, patch: { skipDuplicates: e.target.checked } })}
        className="size-5 accent-fg"
      />
    </label>
  );
}

function ServiceCard({ flow, services, dispatch, onChoose, onReloadPlaylists, onImport, id }: Props & { id: ProviderId }) {
  const dest = flow.dests[id];
  if (!dest) return null;
  const picks = picksOf(flow, id);
  const marks = marksOf(dest, picks);
  const adding = picks.filter((_, i) => marks[i] === "add");
  const already = picks.filter((_, i) => marks[i] === "already");
  const repeats = dest.target.kind === "existing" && !dest.skipDuplicates && dest.existingIds?.kind === "ready"
    ? adding.filter((p) => p.chosen && (dest.existingIds as { value: string[] }).value.includes(p.chosen.track.id))
    : [];
  const name = serviceName(id);
  const newName = dest.target.kind === "new" ? dest.target.name : "";
  const ready = adding.length > 0 && !checking(dest) && (dest.target.kind === "existing" || newName.trim().length > 0);

  return (
    <div className={`p-4 ${card} ${appear}`} data-testid={`service-card-${id}`}>
      <p className="font-medium">{name}</p>
      <p className="mb-3 text-sm text-mute">Connected as {services.find((s) => s.id === id)?.user?.displayName ?? "you"}</p>

      <PlaylistPicker
        provider={id}
        playlists={dest.playlists}
        value={dest.target}
        newLabel="New playlist"
        testId={`playlist-select-${id}`}
        onChange={(picked) => onChoose(id, picked.kind === "new" ? { kind: "new", name: newName || flow.sharedName } : picked)}
        onRetry={() => onReloadPlaylists(id)}
      />
      <div className="mt-2 flex flex-col gap-2">
        {dest.target.kind === "new" ? (
          <label className="block">
            <span className="sr-only">New playlist name</span>
            <input
              value={newName}
              placeholder="Playlist name"
              data-testid={`new-name-${id}`}
              maxLength={100}
              onChange={(e) => dispatch({ type: "dest", provider: id, patch: { target: { kind: "new", name: e.target.value } } })}
              className={input}
            />
          </label>
        ) : (
          <SkipToggle id={id} dest={dest} dispatch={dispatch} />
        )}
        <div aria-live="polite" className="empty:hidden">
          {checking(dest) && <p className="text-sm text-mute">Checking what&apos;s already in this playlist…</p>}
          {dest.existingIds?.kind === "error" && (
            <Note tone="warn">{describeError(dest.existingIds.error, id)} We&apos;ll check again when you confirm.</Note>
          )}
          {already.length > 0 && (
            <Note tone="info">
              {plural(already.length, "song")} already in this playlist will be skipped: {already.map((p) => p.chosen?.track.name).join(", ")}.
            </Note>
          )}
          {repeats.length > 0 && (
            <Note tone="warn">
              Skipping is off, so {plural(repeats.length, "song")} already in this playlist will be added again:{" "}
              {repeats.map((p) => p.chosen?.track.name).join(", ")}.
            </Note>
          )}
        </div>
      </div>

      <p className="mt-4 mb-2 text-xs font-medium tracking-wide text-mute uppercase">Will add {adding.length}, in this order</p>
      <ol className="flex flex-col gap-1.5" data-testid={`preview-${id}`}>
        {adding.map((pick, i) => (
          <li key={pick.original.id} className="flex items-center gap-3">
            <span className="w-5 text-right text-sm text-mute tabular-nums">{i + 1}</span>
            <Art track={pick.chosen?.track} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{pick.chosen?.track.name}</span>
              <span className="block truncate text-xs text-mute">{pick.chosen?.track.artists.join(", ")}</span>
            </span>
          </li>
        ))}
      </ol>
      {adding.length === 0 && <p className="text-sm text-mute">Nothing to add. Go back and pick songs, or choose another playlist.</p>}

      <button type="button" className={`mt-4 w-full ${btn.primary}`} data-testid={`confirm-${id}`} disabled={!ready} onClick={() => onImport([id])}>
        {dest.target.kind === "new" ? `Create “${newName.trim() || "playlist"}” with ${plural(adding.length, "song")}` : `Add ${plural(adding.length, "song")} to ${name}`}
      </button>
    </div>
  );
}

type RowStatus = "added" | "already" | "failed" | "not-added" | "not-imported";
const ROW_TEXT: Record<RowStatus, { text: string; tone: string }> = {
  added: { text: "Added", tone: "text-ok" },
  already: { text: "Already there", tone: "text-mute" },
  failed: { text: "Failed", tone: "text-bad" },
  "not-added": { text: "Not added", tone: "text-warn" },
  "not-imported": { text: "Not imported", tone: "text-mute" },
};

function rowStatuses(picks: Choice[], result: ImportResult): { status: RowStatus; reason?: string }[] {
  const queue = new Map<string, ImportOutcome[]>();
  for (const outcome of result.outcomes) queue.set(outcome.trackId, [...(queue.get(outcome.trackId) ?? []), outcome]);
  return picks.map((pick) => {
    if (!pick.included || !pick.chosen) return { status: "not-imported" };
    const outcome = queue.get(pick.chosen.track.id)?.shift();
    if (!outcome) return { status: result.alreadyThere.includes(pick.chosen.track.id) ? "already" : "not-imported" };
    if (outcome.status === "added") return { status: "added" };
    if (outcome.status === "skipped-duplicate") return { status: "already" };
    return { status: NOT_ATTEMPTED.test(outcome.reason) ? "not-added" : "failed", reason: outcome.reason };
  });
}

function ResultCard({ flow, dispatch, onImport, onLeave, id }: Props & { id: ProviderId }) {
  const dest = flow.dests[id];
  if (!dest || dest.job.kind === "idle") return null;
  const name = serviceName(id);
  const picks = picksOf(flow, id);
  const job = dest.job;
  const result = job.kind === "done" ? job.result : job.prior;

  const rows = result ? rowStatuses(picks, result) : [];
  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const failedIds = result ? result.outcomes.filter((o) => o.status === "failed").length : 0;
  const sent = count("added") + count("failed") + count("not-added");
  const login = LOGIN[id];

  return (
    <div className={`p-4 ${card} ${appear}`} data-testid={`result-${id}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`grid size-9 flex-none place-items-center rounded-full text-base font-bold ${
            job.kind === "submitting" ? "bg-line text-mute" : job.kind === "error" ? "bg-bad-soft text-bad" : failedIds ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"
          }`}
        >
          {job.kind === "submitting" ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : job.kind === "error" ? "!" : failedIds ? "!" : "✓"}
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-xs font-medium tracking-wide text-mute uppercase">{name}</p>
          <p className="font-medium">
            {job.kind === "submitting"
              ? result
                ? `Retrying ${plural(failedIds, "song")}…`
                : `Adding to ${name}…`
              : !result
                ? "Not imported"
                : failedIds
                  ? `${count("added")} of ${sent} added to “${result.playlist.name}”`
                  : count("added")
                    ? `Added ${plural(count("added"), "song")} to “${result.playlist.name}”`
                    : `Everything was already in “${result.playlist.name}”`}
          </p>
          {result && (
            <p className="mt-0.5 text-sm text-mute">
              {[
                `${count("added")} added`,
                count("already") && `${count("already")} already there`,
                count("failed") && `${count("failed")} failed`,
                count("not-added") && `${count("not-added")} not added`,
                count("not-imported") && `${count("not-imported")} not imported`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {job.kind === "error" && (
        <div className="mt-3" role="alert">
          <Note tone="bad">
            <p>
              {describeError(job.error, id)}
              {dest.created && !result ? ` The playlist “${dest.created.name}” was created, but its songs may not have been added.` : ""}
            </p>
            {(job.error.kind === "network" || job.error.kind === "unknown") && (
              <p className="mt-1">We can&apos;t tell whether anything was added. Check the playlist before trying again.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {job.error.status !== 401 && job.error.kind !== "duplicate-request" && (
                <button
                  type="button"
                  className={btn.small}
                  data-testid={`retry-${id}`}
                  onClick={() => (result ? void retryFailed(id, result, dispatch) : onImport([id]))}
                >
                  Try again
                </button>
              )}
              {job.error.status === 401 && login && (
                <a href={login} className={btn.small} onClick={onLeave}>
                  Reconnect {name}
                </a>
              )}
            </div>
          </Note>
        </div>
      )}

      {result && failedIds > 0 && job.kind === "done" && (
        <div className="mt-3">
          <Note tone="warn">
            Some songs couldn&apos;t be added. Nothing was retried automatically, so nothing was added twice. Retrying sends only those{" "}
            {plural(failedIds, "song")}.
          </Note>
        </div>
      )}

      {result && (
        <ol className="mt-3 border-t border-line">
          {picks.map((pick, i) => (
            <li key={pick.original.id} data-testid={`result-row-${id}-${i}`} className="flex items-baseline gap-3 border-b border-line py-2 text-sm last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{pick.chosen?.track.name ?? pick.original.title}</span>
                {rows[i].status === "failed" && <span className="block text-xs text-mute">{rows[i].reason}</span>}
              </span>
              <span className={`flex-none font-medium ${ROW_TEXT[rows[i].status].tone}`}>{ROW_TEXT[rows[i].status].text}</span>
            </li>
          ))}
        </ol>
      )}

      {result && (
        <div className="mt-3 flex flex-wrap gap-2">
          {failedIds > 0 && (
            <button
              type="button"
              className={btn.primary + " py-2 text-sm"}
              data-testid={`retry-failed-${id}`}
              disabled={job.kind === "submitting"}
              onClick={() => void retryFailed(id, result, dispatch)}
            >
              Retry failed ({failedIds})
            </button>
          )}
          <a href={playlistUrl(id, result.playlist.id)} target="_blank" rel="noreferrer" className={btn.small} data-testid={`open-playlist-${id}`}>
            {id === "apple-music" ? "Open Apple Music library" : `Open playlist in ${name}`}
          </a>
        </div>
      )}
    </div>
  );
}
