"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The stage's moving parts, shared by the draft room's bookends (Opening Night, the final whistle,
 * the welcome card) and the season page's win (APE-230): confetti, count-ups and the reduced-motion
 * switch. No CSS module of its own, so the season page can use it without the draft room's styles.
 */

/** The six position hues: the only colors the confetti is allowed, because they're the draft's. */
const CONFETTI = ["--color-qb", "--color-rb", "--color-wr", "--color-te", "--color-k", "--color-dst", "--color-warn"];

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (onChange: () => void) => {
  const mql = window.matchMedia(REDUCED);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/** Whether the visitor asked for reduced motion; false on the server. Shared with the draft finale. */
export const useReducedMotion = () => useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);

/** Tabular digits running up to the league's real number, fast, the way a broadcast graphic fills. */
export function CountUp({ to, delay, still, decimals = 0, ms = 620 }: { to: number; delay: number; still: boolean; decimals?: number; ms?: number }) {
  const [n, setN] = useState(still ? to : 0);
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setN(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, delay, still, ms]);
  return <>{n.toFixed(decimals)}</>;
}

/**
 * Confetti in the six position colors and amber. Canvas, one burst, then it stops drawing and the
 * canvas is removed with its host. Opening Night fires two cannons from the bottom corners for
 * about three seconds; the welcome card (Welcome.tsx) fires a smaller fountain up from itself.
 */
export function StageConfetti({
  from = "corners",
  life = 3100,
  density = 1,
  className,
}: {
  from?: "corners" | "bottom";
  /** Total run in ms; the last 700ms fade out. */
  life?: number;
  /** Scales the number of pieces. */
  density?: number;
  className: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.width = w * dpr;
    el.height = h * dpr;
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    const colors = CONFETTI.map((v) => styles.getPropertyValue(v).trim() || "#ffffff");
    const count = Math.round((w < 600 ? 110 : 190) * density);
    const fountain = from === "bottom";
    const bits = Array.from({ length: count }, (_, i) => {
      const left = i % 2 === 0;
      const angle = fountain
        ? -Math.PI / 2 + (Math.random() - 0.5) * 1.1
        : (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const speed = fountain ? (w < 600 ? 10 : 13) + Math.random() * 8 : (w < 600 ? 13 : 19) + Math.random() * 9;
      return {
        x: fountain ? w / 2 + (Math.random() - 0.5) * Math.min(320, w * 0.6) : left ? 0 : w,
        y: fountain ? h - 90 : h,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        size: 6 + Math.random() * 7,
        color: colors[i % colors.length],
      };
    });
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      const t = now - started;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = t > life - 700 ? Math.max(0, 1 - (t - (life - 700)) / 700) : 1;
      for (const b of bits) {
        b.vy += 0.42;
        b.vx *= 0.985;
        b.vy *= 0.985;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.color;
        // A flat rectangle foreshortened as it tumbles: paper, not particles.
        ctx.fillRect(-b.size / 2, (-b.size / 4) * Math.abs(Math.cos(b.r * 2)), b.size, (b.size / 2) * Math.abs(Math.cos(b.r * 2)) + 1);
        ctx.restore();
      }
      if (t < life) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [from, life, density]);
  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
