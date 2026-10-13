/** FATE brand mark: an astrolabe coin whose pointer becomes the F. Inline so it inherits color and never flashes. */
export function Mark({ size = 28, className = "", mono = false }: { size?: number; className?: string; mono?: boolean }) {
  if (mono) return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <circle cx="64" cy="64" r="60" strokeWidth="5" /><circle cx="64" cy="64" r="46" strokeWidth="2" strokeDasharray="2 5.2" opacity=".8" />
      <path d="M64 10v10M64 108v10M10 64h10M108 64h10" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 92V36h36M46 62h28" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" /><circle cx="46" cy="92" r="6" fill="currentColor" stroke="none" />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="fate-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#baffea" /><stop offset="1" stopColor="#4dffc3" /></linearGradient>
        <radialGradient id="fate-face" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#1d1036" /><stop offset="1" stopColor="#0b0516" /></radialGradient>
      </defs>
      <circle cx="64" cy="64" r="60" fill="url(#fate-face)" stroke="url(#fate-rim)" strokeWidth="5" />
      <circle cx="64" cy="64" r="46" fill="none" stroke="#4dffc3" strokeWidth="2" strokeDasharray="2 5.2" opacity=".85" />
      <path d="M64 10v10M64 108v10M10 64h10M108 64h10" stroke="#4dffc3" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 92V36h36M46 62h28" fill="none" stroke="#f2eeff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M46 92V36h36M46 62h28" fill="none" stroke="#4dffc3" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="46" cy="92" r="6" fill="#4dffc3" />
    </svg>
  );
}

export function Logo({ size = 28, className = "", wordmark = true }: { size?: number; className?: string; wordmark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      {wordmark && <span className="display" style={{ fontSize: size * 0.95, lineHeight: 1, letterSpacing: ".02em" }}>Fate</span>}
    </span>
  );
}
