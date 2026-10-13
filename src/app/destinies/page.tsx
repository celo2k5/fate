import Link from "next/link";
import { CharacterScene } from "@/components/Scene";
import { DESTINIES, DESTINY_META } from "@/engine/config";

const ArrowIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export default function Destinies() {
  return (
    <div className="mx-auto max-w-[1320px] px-5 sm:px-8 pt-28 pb-16">
      <h1 className="display text-[40px] sm:text-[56px]">The four <span className="display-light">destinies</span></h1>
      <p className="lede mt-4 max-w-xl">Each is a real economic mechanism with its own vault, its own execution conditions and its own accounting. A coin wears exactly one, forever.</p>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {DESTINIES.map((d) => {
          const m = DESTINY_META[d];
          return (
            <div key={d} data-destiny={d} className="card p-4">
              <CharacterScene name={d.toLowerCase()} />
              <div className="card-sm mt-4 rounded-[12px] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="display text-[22px]">{m.title}</p>
                  <Link href={`/destinies/${d.toLowerCase()}`} aria-label={`Open ${m.title}`} className="arrow-btn"><ArrowIcon /></Link>
                </div>
                <p className="small mt-1" style={{ color: "var(--accent)" }}>{m.tagline}</p>
                <p className="small mt-2 text-ivory-2">{m.purpose}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
