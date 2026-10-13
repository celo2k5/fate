/**
 * FATE brand mark: the official metallic F-in-a-circle emblem (public/brand/emblem.png, cut to a transparent
 * disc from the supplied artwork; geometry untouched). `mono` renders the traced flat version (favicon SVG) in
 * currentColor-free form for places that need a tiny, crisp mark.
 */
export function Mark({ size = 28, className = "", mono = false, priority = false }: { size?: number; className?: string; mono?: boolean; priority?: boolean }) {
  // Always the official raster (cut from the supplied artwork, never redrawn); srcset picks the sharpest size for the
  // device pixel ratio. `mono` is kept for API compatibility and renders the same emblem.
  void mono;
  const base = size <= 32 ? 64 : size <= 64 ? 128 : size <= 128 ? 256 : 512;
  const next = Math.min(base * 2, 512);
  return <img src={`/brand/emblem-${base}.png`} srcSet={`/brand/emblem-${base}.png 1x, /brand/emblem-${next}.png 2x`} width={size} height={size} alt="" aria-hidden="true" draggable={false} loading={priority ? "eager" : "lazy"} decoding="async" className={`mark select-none ${className}`} style={{ width: size, height: size }} />;
}

export function Logo({ size = 28, className = "", wordmark = true }: { size?: number; className?: string; wordmark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} priority />
      {wordmark && <span className="display wordmark" style={{ fontSize: size * 0.95, lineHeight: 1, letterSpacing: ".02em" }}>Fate</span>}
    </span>
  );
}
