"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import type { Playlist } from "@/core/types";
import type { ProviderId } from "@/core/types";
import { describeError, serviceName, type Remote, type Target } from "./flow";
import { btn } from "./ui";

const songCount = (p: Playlist) => (p.trackCount === undefined ? "" : `${p.trackCount} ${p.trackCount === 1 ? "song" : "songs"}`);

type Picked = { kind: "new" } | { kind: "existing"; playlist: Playlist };

function Cover({ playlist }: { playlist?: Playlist }) {
  return playlist?.imageUrl ? (
    <Image src={playlist.imageUrl} alt="" width={40} height={40} unoptimized className="size-10 flex-none rounded-md bg-line object-cover" />
  ) : (
    <span aria-hidden className="grid size-10 flex-none place-items-center rounded-md bg-line/70 text-lg text-mute">
      {playlist ? "♪" : "+"}
    </span>
  );
}

export function PlaylistPicker({
  provider,
  playlists,
  value,
  newLabel,
  testId,
  onChange,
  onRetry,
}: {
  provider: ProviderId;
  playlists: Remote<Playlist[]>;
  value: Target;
  newLabel: string;
  testId: string;
  onChange: (picked: Picked) => void;
  onRetry: () => void;
}) {
  const service = serviceName(provider);
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);

  const all = playlists.kind === "ready" ? playlists.value : [];
  const matching = all.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const options: Picked[] = [
    { kind: "new" },
    ...[...matching.filter((p) => p.editable), ...matching.filter((p) => !p.editable)].map((playlist) => ({ kind: "existing" as const, playlist })),
  ];
  const enabled = (o: Picked) => o.kind === "new" || o.playlist.editable;
  const current = Math.min(active, options.length - 1);

  function pick(option: Picked) {
    if (!enabled(option)) return;
    onChange(option);
    dialog.current?.close();
  }

  function move(step: 1 | -1) {
    for (let i = current + step; i >= 0 && i < options.length; i += step) {
      if (enabled(options[i])) {
        setActive(i);
        document.getElementById(`${listId}-${i}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="dialog"
        onClick={() => {
          setFilter("");
          setActive(0);
          dialog.current?.showModal();
        }}
        className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel p-2.5 pr-3 text-left transition hover:border-fg/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
      >
        <Cover playlist={value.kind === "existing" ? value.playlist : undefined} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{value.kind === "existing" ? value.playlist.name : newLabel}</span>
          <span className="block text-sm text-mute">
            {value.kind === "existing" ? songCount(value.playlist) || "Existing playlist" : "Created when you confirm"}
          </span>
        </span>
        <span className="text-sm font-medium text-mute">Change</span>
      </button>

      <dialog
        ref={dialog}
        aria-label={`Choose a ${service} playlist`}
        className="m-auto w-full max-w-md overflow-hidden rounded-2xl border border-line bg-panel p-0 text-fg shadow-2xl backdrop:bg-fg/30 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none max-sm:border-0 sm:max-h-[min(36rem,80vh)] open:flex open:flex-col"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <p className="font-medium">Choose a {service} playlist</p>
          <button type="button" className={btn.small} onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <div className="border-b border-line p-3">
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${current}`}
            aria-label={`Search your ${service} playlists`}
            placeholder={`Search ${all.length || ""} playlists`.replace("  ", " ")}
            value={filter}
            data-testid={`${testId}-filter`}
            onChange={(e) => {
              setFilter(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                move(e.key === "ArrowDown" ? 1 : -1);
              }
              if (e.key === "Enter") {
                e.preventDefault();
                pick(options[current]);
              }
            }}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-[15px] placeholder:text-mute focus:border-fg focus:outline-none"
          />
        </div>

        <ul id={listId} role="listbox" aria-label={`${service} playlists`} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {options.map((option, i) => {
            const ok = enabled(option);
            const selected = option.kind === value.kind && (option.kind === "new" || (value.kind === "existing" && value.playlist.id === option.playlist.id));
            return (
              <li
                key={option.kind === "new" ? "new" : option.playlist.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                aria-disabled={!ok}
                data-testid={`${testId}-option-${i}`}
                onClick={() => pick(option)}
                onMouseMove={() => ok && setActive(i)}
                className={`flex items-center gap-3 rounded-xl p-2 ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${
                  i === current ? "bg-bg ring-1 ring-fg/15" : option.kind === "new" ? "bg-panel" : ""
                } ${option.kind === "new" ? "sticky top-0 z-10 mb-1 shadow-[0_6px_0_-5px_var(--color-line)]" : ""}`}
              >
                <Cover playlist={option.kind === "existing" ? option.playlist : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.kind === "new" ? "New playlist…" : option.playlist.name}</span>
                  <span className={`block text-sm text-mute ${ok ? "truncate" : ""}`}>
                    {option.kind === "new"
                      ? "Created when you confirm"
                      : ok
                        ? songCount(option.playlist) || "Playlist"
                        : "You can't add to this playlist. It's owned by someone else and not collaborative."}
                  </span>
                </span>
                {selected && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                )}
              </li>
            );
          })}
          {playlists.kind === "loading" && <li className="p-3 text-sm text-mute">Loading your playlists…</li>}
          {playlists.kind === "ready" && matching.length === 0 && (
            <li className="p-3 text-sm text-mute">{filter ? `No playlists match “${filter}”.` : "You don't have any playlists yet."}</li>
          )}
          {playlists.kind === "error" && (
            <li className="p-3 text-sm">
              <p className="text-bad">{describeError(playlists.error, provider)}</p>
              <button type="button" className={`mt-2 ${btn.small}`} onClick={onRetry}>
                Try again
              </button>
            </li>
          )}
        </ul>
      </dialog>
    </>
  );
}
