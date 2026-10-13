/**
 * Full-bleed looping scene. Uses the generated .mp4 when present and the still
 * as poster/fallback, exactly like the reference's background <video> sections.
 */
export function Scene({ name, className = "", overlay = "bg-obsidian/40" }: { name: string; className?: string; overlay?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <video className="absolute inset-0 h-full w-full object-cover" src={`/scenes/${name}.mp4`} poster={`/scenes/${name}.jpg`} autoPlay loop muted playsInline preload="auto" />
      {overlay && <div className={`absolute inset-0 ${overlay}`} />}
    </div>
  );
}

/** Square character loop used in the crew cards and the token page. */
export function CharacterScene({ name, className = "" }: { name: string; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-[20px] pb-[100%] ${className}`}>
      <video className="absolute inset-0 h-full w-full object-cover" src={`/scenes/${name}.mp4`} poster={`/scenes/${name}.jpg`} autoPlay loop muted playsInline preload="metadata" />
    </div>
  );
}
