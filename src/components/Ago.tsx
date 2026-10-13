"use client";
import { ago, countdown } from "@/lib/format";
/** Relative times ("26s ago", "in 3s") differ by a tick between the server render and hydration; that is expected, not a bug. */
export function Ago({ t }: { t: number | string | bigint }) { return <span suppressHydrationWarning>{ago(t as never)}</span>; }
export function Countdown({ t }: { t: number }) { return <span suppressHydrationWarning>{countdown(t)}</span>; }
