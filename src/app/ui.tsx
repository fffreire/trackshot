import Image from "next/image";
import type { ReactNode } from "react";
import type { CatalogTrack } from "@/core/types";

const ring = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg";
export const btn = {
  primary: `inline-flex items-center justify-center gap-2 rounded-full bg-acc px-5 py-3 text-[15px] font-semibold text-acc-ink transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40 ${ring}`,
  ghost: `inline-flex items-center justify-center gap-2 rounded-full border border-line bg-panel px-5 py-3 text-[15px] font-medium text-fg transition hover:border-fg/40 active:scale-[.98] disabled:opacity-40 ${ring}`,
  small: `inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-fg transition hover:border-fg/40 disabled:opacity-40 ${ring}`,
  link: `rounded text-sm font-medium text-fg underline decoration-line decoration-2 underline-offset-4 hover:decoration-fg ${ring}`,
};
export const input =
  "w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-[15px] text-fg placeholder:text-mute focus:border-fg focus:outline-none";
export const card = "rounded-2xl border border-line bg-panel";
export const appear = "transition duration-300 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none";

export function Art({ track, size = 44 }: { track?: CatalogTrack; size?: number }) {
  const src = track?.album.imageUrl;
  return src ? (
    <Image src={src} alt="" width={size} height={size} unoptimized className="flex-none rounded-md bg-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="grid flex-none place-items-center rounded-md bg-line/70 text-mute" style={{ width: size, height: size }}>
      <svg width={size / 2.4} height={size / 2.4} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </span>
  );
}

export const describeTrack = (track: CatalogTrack) =>
  [track.artists.join(", "), track.album.name, track.album.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ");

export function Note({ tone, children }: { tone: "bad" | "warn" | "ok" | "info"; children: ReactNode }) {
  const tones = {
    bad: "border-bad/25 bg-bad-soft text-fg",
    warn: "border-warn/25 bg-warn-soft text-fg",
    ok: "border-ok/25 bg-ok-soft text-fg",
    info: "border-line bg-bg text-fg",
  };
  return <div className={`rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${tones[tone]}`}>{children}</div>;
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex gap-2.5 bg-linear-to-t from-bg from-60% to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*:last-child]:flex-1">
      {children}
    </div>
  );
}
