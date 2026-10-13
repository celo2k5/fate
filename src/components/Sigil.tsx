/** FATE sigil: an astrolabe ring with a single pointer — the brand mark. */
export function Sigil({ size = 28, className = "", draw = false }: { size?: number; className?: string; draw?: boolean }) {
  const dash = draw ? { strokeDasharray: 300, strokeDashoffset: 300, animation: "draw 1.4s cubic-bezier(.2,.8,.2,1) forwards" } : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.5" style={dash} />
      <circle cx="24" cy="24" r="13" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" style={dash && { ...dash, animationDelay: ".2s" }} />
      <path d="M24 3v8M24 37v8M3 24h8M37 24h8" stroke="currentColor" strokeWidth="1.5" style={dash && { ...dash, animationDelay: ".4s" }} />
      <path d="M24 24 L35 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={dash && { ...dash, animationDelay: ".7s" }} />
      <circle cx="24" cy="24" r="2.5" fill="currentColor" />
    </svg>
  );
}
