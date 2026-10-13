"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll choreography:
 *  - .reveal / .reveal-scale elements fade-rise once they enter the viewport (staggered via inline transitionDelay)
 *  - [data-parallax="0.2"] elements translate with scroll
 *  - [data-timeline] sets --p (0..1) as the element crosses the viewport, driving .timeline-fill
 */
export function Reveal() {
  const path = usePathname();
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.in), .reveal-scale:not(.in)"));
    if (reduce || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); }
    else {
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
      els.forEach((e) => io.observe(e));
      // anything already on screen reveals immediately
      els.filter((e) => e.getBoundingClientRect().top < innerHeight).forEach((e) => e.classList.add("in"));
    }
    const px = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
    const tl = Array.from(document.querySelectorAll<HTMLElement>("[data-timeline]"));
    let raf = 0;
    const onScroll = () => {
      if (reduce) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = scrollY;
        for (const e of px) e.style.transform = `translate3d(0, ${y * Number(e.dataset.parallax || 0.2)}px, 0)`;
        for (const e of tl) {
          const r = e.getBoundingClientRect();
          const p = Math.min(1, Math.max(0, (innerHeight * 0.8 - r.top) / (r.height + innerHeight * 0.3)));
          e.style.setProperty("--p", p.toFixed(3));
        }
      });
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => { removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [path]);
  return null;
}
