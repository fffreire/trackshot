import { PRODUCT } from "./brand";
import Trackshot from "./trackshot";

export default function Home() {
  const [before, after] = PRODUCT.name.split(PRODUCT.marked);
  return (
    <main className="mx-auto max-w-xl px-4 pt-5">
      <header className="mb-6 flex items-center justify-between">
        <p className="text-lg font-bold tracking-tight">
          {before}
          <span className="relative isolate px-0.5">
            <span aria-hidden className="absolute inset-x-0 top-[0.3em] bottom-[0.05em] -z-10 -skew-x-6 -rotate-1 rounded-[3px] bg-acc" />
            <span className="text-acc-ink">{PRODUCT.marked}</span>
          </span>
          {after}
        </p>
      </header>
      <Trackshot />
    </main>
  );
}
