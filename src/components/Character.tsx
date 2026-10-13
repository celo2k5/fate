"use client";
import { useEffect, useId, useState } from "react";
import type { DestinyType } from "@/engine/config";

export interface CharacterProps {
  destiny: DestinyType;
  /** 0..1 vault progress toward the next execution */
  progress?: number;
  /** cumulative metric that grows the character (burns / liquidity / epochs / assets) */
  level?: number;
  /** bump this to play the destiny's execution animation (rebirth / waves / etc.) */
  pulseKey?: number;
  /** Orbit: allocation shares for the satellites */
  satellites?: { label: string; share: number }[];
  size?: number | string;
  className?: string;
  idle?: boolean;
}

/**
 * The four destiny characters, drawn procedurally. Each one reads real protocol
 * state: `progress` drives glow / weight / charge, `level` grows the figure,
 * `pulseKey` fires the execution moment.
 */
export function Character(p: CharacterProps) {
  const id = useId().replace(/:/g, "");
  const size = p.size ?? 240;
  const progress = Math.max(0, Math.min(1, p.progress ?? 0));
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (p.pulseKey) setPulse((x) => x + 1);
  }, [p.pulseKey]);
  const common = { width: size, height: size, viewBox: "0 0 200 200", className: p.className, role: "img" as const };

  if (p.destiny === "PHOENIX") {
    const glow = 0.25 + progress * 0.75;
    return (
      <svg {...common} aria-label={`Phoenix, vault ${Math.round(progress * 100)}% charged`}>
        <defs>
          <radialGradient id={`${id}-g`} cx="50%" cy="60%" r="55%">
            <stop offset="0%" stopColor="#ffd089" stopOpacity={glow} />
            <stop offset="45%" stopColor="#ff5a1f" stopOpacity={glow * 0.55} />
            <stop offset="100%" stopColor="#c8102e" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffb36b" />
            <stop offset="60%" stopColor="#ff5a1f" />
            <stop offset="100%" stopColor="#c8102e" />
          </linearGradient>
          <filter id={`${id}-f`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={2 + progress * 5} />
          </filter>
        </defs>
        {pulse > 0 && <circle key={pulse} cx="100" cy="110" r="40" fill="none" stroke="#ffd089" strokeWidth="1.5" className="rebirth" />}
        <circle cx="100" cy="112" r="78" fill={`url(#${id}-g)`} />
        {/* wings */}
        <g filter={`url(#${id}-f)`} opacity={0.45 + progress * 0.4}>
          <path d="M100 118 C 70 110, 46 88, 30 54 C 56 70, 76 84, 100 96 Z" fill="#ff5a1f" />
          <path d="M100 118 C 130 110, 154 88, 170 54 C 144 70, 124 84, 100 96 Z" fill="#ff5a1f" />
        </g>
        <path d="M100 118 C 72 110, 50 90, 36 60 C 58 74, 78 86, 100 98 Z" fill={`url(#${id}-b)`} />
        <path d="M100 118 C 128 110, 150 90, 164 60 C 142 74, 122 86, 100 98 Z" fill={`url(#${id}-b)`} />
        {/* body: teardrop */}
        <path d="M100 70 C 118 86, 122 110, 112 134 C 108 146, 92 146, 88 134 C 78 110, 82 86, 100 70 Z" fill={`url(#${id}-b)`} />
        {/* ember core, brightens with progress */}
        <ellipse cx="100" cy="112" rx={6 + progress * 7} ry={9 + progress * 9} fill="#ffe7b3" opacity={0.35 + progress * 0.65} />
        {/* crest */}
        <path d="M100 70 C 104 58, 112 52, 118 46 C 110 56, 108 64, 106 72 Z" fill="#ffb36b" />
        <path d="M100 70 C 96 58, 88 52, 82 46 C 90 56, 92 64, 94 72 Z" fill="#ffb36b" />
        {/* tail flames */}
        <path d="M94 142 C 90 158, 84 170, 76 184 C 88 172, 96 160, 100 146 Z" fill="#ff5a1f" opacity={0.5 + progress * 0.5} />
        <path d="M106 142 C 110 158, 116 170, 124 184 C 112 172, 104 160, 100 146 Z" fill="#c8102e" opacity={0.5 + progress * 0.5} />
        {/* eyes */}
        <circle cx="94" cy="92" r="2.2" fill="#080709" />
        <circle cx="106" cy="92" r="2.2" fill="#080709" />
      </svg>
    );
  }

  if (p.destiny === "GRAVITY") {
    const rings = 1 + Math.min(4, Math.floor(p.level ?? 0));
    const weight = 0.35 + progress * 0.65;
    return (
      <svg {...common} aria-label={`Gravity, ${rings} rings, vault ${Math.round(progress * 100)}%`}>
        <defs>
          <radialGradient id={`${id}-s`} cx="38%" cy="32%" r="70%">
            <stop offset="0%" stopColor="#9fb4ff" />
            <stop offset="45%" stopColor="#2d5bff" />
            <stop offset="100%" stopColor="#0b1a5c" />
          </radialGradient>
          <radialGradient id={`${id}-h`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2d5bff" stopOpacity={0.35 * weight} />
            <stop offset="100%" stopColor="#2d5bff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="104" r="90" fill={`url(#${id}-h)`} />
        {/* floor dimple — heavier as the vault fills */}
        <ellipse cx="100" cy="166" rx={44 + progress * 18} ry={5 + progress * 4} fill="#2d5bff" opacity={0.12 + progress * 0.2} />
        {/* back halves of rings */}
        {Array.from({ length: rings }).map((_, i) => (
          <ellipse key={`b${i}`} cx="100" cy="104" rx={56 + i * 12} ry={14 + i * 4} fill="none" stroke="#b8c2d6" strokeWidth="1.2" opacity={0.55 - i * 0.08}
            transform={`rotate(${-18 + i * 9} 100 104)`} strokeDasharray="0.1 0" style={{ clipPath: "inset(0 0 50% 0)" }} />
        ))}
        <circle cx="100" cy="104" r={38 + progress * 6} fill={`url(#${id}-s)`} />
        {/* face */}
        <circle cx="90" cy="98" r="2.4" fill="#eaf0ff" />
        <circle cx="110" cy="98" r="2.4" fill="#eaf0ff" />
        <path d="M93 112 Q 100 116 107 112" stroke="#eaf0ff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {/* front halves of rings */}
        {Array.from({ length: rings }).map((_, i) => (
          <ellipse key={`f${i}`} cx="100" cy="104" rx={56 + i * 12} ry={14 + i * 4} fill="none" stroke="#b8c2d6" strokeWidth="1.4" opacity={0.9 - i * 0.12}
            transform={`rotate(${-18 + i * 9} 100 104)`} style={{ clipPath: "inset(50% 0 0 0)" }} />
        ))}
        {pulse > 0 && <ellipse key={pulse} cx="100" cy="104" rx="56" ry="14" fill="none" stroke="#b8c2d6" strokeWidth="1" className="wave" />}
      </svg>
    );
  }

  if (p.destiny === "ECHO") {
    const bars = 5;
    return (
      <svg {...common} aria-label={`Echo, vault ${Math.round(progress * 100)}% to next epoch`}>
        <defs>
          <linearGradient id={`${id}-e`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dcd3ff" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        {pulse > 0 && [0, 1, 2].map((i) => (
          <circle key={`${pulse}-${i}`} cx="100" cy="118" r="40" fill="none" stroke="#dcd3ff" strokeWidth="1" className="wave" style={{ animationDelay: `${i * 0.35}s` }} />
        ))}
        {/* standing ripples — opacity tracks charge */}
        {[0, 1, 2, 3].map((i) => (
          <ellipse key={i} cx="100" cy="160" rx={28 + i * 18} ry={5 + i * 3} fill="none" stroke="#8b5cf6" strokeWidth="1" opacity={Math.max(0, progress - i * 0.22) * 0.9} />
        ))}
        {/* the figure: stacked glass rings */}
        {Array.from({ length: bars }).map((_, i) => {
          const y = 150 - i * 22;
          const rx = 26 - i * 3.5;
          return (
            <g key={i}>
              <ellipse cx="100" cy={y} rx={rx} ry={7} fill="#1c1430" stroke={`url(#${id}-e)`} strokeWidth="1.6" />
              <ellipse cx="100" cy={y - 3} rx={rx - 4} ry={4} fill="#8b5cf6" opacity={0.18 + progress * 0.45} />
            </g>
          );
        })}
        {/* head */}
        <circle cx="100" cy="46" r="14" fill="#241a3f" stroke="#dcd3ff" strokeWidth="1.6" />
        <circle cx="95" cy="44" r="2" fill="#dcd3ff" />
        <circle cx="105" cy="44" r="2" fill="#dcd3ff" />
        <circle cx="100" cy="46" r={18 + progress * 10} fill="none" stroke="#dcd3ff" strokeWidth="0.8" opacity={0.15 + progress * 0.4} />
      </svg>
    );
  }

  // ORBIT
  const sats = (p.satellites?.length ? p.satellites : [{ label: "SOL", share: 0.4 }, { label: "USDC", share: 0.3 }, { label: "LST", share: 0.2 }]).slice(0, 4);
  return (
    <svg {...common} aria-label={`Orbit, ${sats.length} satellites, vault ${Math.round(progress * 100)}%`}>
      <defs>
        <radialGradient id={`${id}-o`} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#9ff5d4" />
          <stop offset="50%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#064e3b" />
        </radialGradient>
      </defs>
      {pulse > 0 && <circle key={pulse} cx="100" cy="100" r="40" fill="none" stroke="#22d3ee" strokeWidth="1.2" className="wave" />}
      {sats.map((s, i) => {
        const r = 46 + i * 16;
        const dur = 18 + i * 9;
        const size = 3 + s.share * 10;
        return (
          <g key={s.label}>
            <ellipse cx="100" cy="100" rx={r} ry={r * 0.42} fill="none" stroke="#22d3ee" strokeWidth="0.8" opacity={0.22 + progress * 0.25} transform={`rotate(${-20 + i * 14} 100 100)`} />
            <g style={{ transformOrigin: "100px 100px", animation: p.idle ? undefined : `satellite ${dur}s linear infinite` }} transform={`rotate(${-20 + i * 14} 100 100)`}>
              <g transform={`translate(${100 + r} 100)`}>
                <circle r={size} fill={i % 2 ? "#22d3ee" : "#9ff5d4"} />
                <text x={size + 3} y="3" fontSize="7" fill="#9ff5d4" opacity="0.8" fontFamily="inherit">{s.label}</text>
              </g>
            </g>
          </g>
        );
      })}
      <circle cx="100" cy="100" r={24 + progress * 6} fill={`url(#${id}-o)`} />
      <circle cx="100" cy="100" r={30 + progress * 14} fill="none" stroke="#10b981" strokeWidth="1" opacity={0.2 + progress * 0.5} />
      <circle cx="93" cy="96" r="2.2" fill="#042f22" />
      <circle cx="107" cy="96" r="2.2" fill="#042f22" />
      <circle cx="100" cy="104" r="1.6" fill="#042f22" />
    </svg>
  );
}
