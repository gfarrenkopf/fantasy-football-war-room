"use client";

import { useEffect, useRef } from "react";
import { cx } from "./cx";
import { DOT_ROWS, layoutDots } from "./dotFont";

/** One run of text on the ribbon, in one color: a CSS custom property name from globals.css. */
export interface RibbonSegment {
  text: string;
  color?: string;
}

/** Lamp rows on the board: the font's seven, plus one dark row above and below. */
const ROWS = DOT_ROWS + 2;
/** CSS pixels from one lamp to the next. */
const PITCH = 3;
/** Lamp columns per second while a message runs. */
const SPEED = 120;
/** Dark lamps between the running message and the line that parks. */
const GAP = 24;

/**
 * A stadium ribbon board: an LED dot matrix across a league's line on the goodbye (Farewell.tsx),
 * in a 5×7 dot font (dotFont.ts).
 *
 * `lit`: a finished draft. `message` runs across the board once, right to left, in the colors it's
 * given (each player in their position's hue); the short `park` line follows it in and stops at
 * the left edge, where it stays lit, the way a real board settles on its standing message. `dark`:
 * a paused draft. The board is switched off; its `park` line sits in the lamps at a glow too faint
 * to call lit, and finishing the draft is what would light it. Unlit lamps are always drawn,
 * faintly, because a ribbon board is a grid of lamps whether they're on or not.
 *
 * Canvas 2D, one board per line, drawing only lamps. The run lasts a few seconds and the loop then
 * stops for good. A hidden tab or reduced motion gets the parked board at once.
 */
export function Ribbon({
  message = [],
  park,
  mode,
  delay = 0,
  label,
}: {
  message?: RibbonSegment[];
  park: RibbonSegment[];
  mode: "lit" | "dark";
  delay?: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = [...message, { text: "|" }, ...park].map((g) => `${g.color ?? ""}:${g.text}`).join("|");

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(document.documentElement);
    const resolve = (v?: string) => (v ? css.getPropertyValue(v).trim() : "") || css.getPropertyValue("--color-text").trim() || "#e7ebf0";
    const off = css.getPropertyValue("--color-chip").trim() || "#2f3743";
    const runs = (segs: RibbonSegment[]) => segs.map((g) => ({ text: g.text, color: resolve(g.color) }));

    const lit = mode === "lit";
    const running = lit && message.length > 0;
    const head = running ? [...layoutDots(runs(message)), ...Array.from({ length: GAP }, () => ({ bits: 0, color: off }))] : [];
    const tape = [...head, ...layoutDots(runs(park))];
    /** The tape's position when the park line sits at the left edge, one dark lamp in. */
    const parked = 1 - head.length;

    let cols = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      cols = Math.floor(w / PITCH);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(ROWS * PITCH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** Draws the board with the tape's first column at display column `at`. */
    const draw = (at: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const shift = Math.round(at);
      for (let c = 0; c < cols; c++) {
        const col = tape[c - shift];
        for (let r = 0; r < ROWS; r++) {
          const fontRow = r - 1;
          const on = col && fontRow >= 0 && fontRow < DOT_ROWS && (col.bits >> fontRow) & 1;
          const x = c * PITCH + 0.5;
          const y = r * PITCH + 0.5;
          if (on) {
            ctx.fillStyle = col.color;
            if (lit) {
              // A lamp that's on bleeds a little light into its neighbors.
              ctx.globalAlpha = 0.22;
              ctx.fillRect(x - 0.75, y - 0.75, 3.5, 3.5);
            }
            ctx.globalAlpha = lit ? 1 : 0.4;
            ctx.fillRect(x, y, 2, 2);
          } else {
            ctx.fillStyle = off;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(x, y, 2, 2);
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    size();
    const still = !running || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (still) draw(parked);
    else {
      draw(cols);
      const from = cols;
      const distance = from - parked;
      // Constant speed like a real board, easing only over the last stretch as the line parks.
      const duration = (distance / SPEED) * 1000;
      timer = setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration);
          const eased = p < 0.85 ? p : 0.85 + 0.15 * (1 - Math.pow(1 - (p - 0.85) / 0.15, 3));
          draw(from - distance * eased);
          if (p < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }, delay);
    }

    // A line that actually changes width redraws the board parked; the run is never replayed. (The
    // observer also reports once on observe(), at the width already drawn, which changes nothing.)
    let width = canvas.clientWidth;
    const observer = new ResizeObserver(() => {
      if (canvas.clientWidth === width) return;
      width = canvas.clientWidth;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      size();
      draw(parked);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
    };
    // `key` stands in for the segment arrays, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, delay]);

  return <canvas ref={ref} className={cx("ribbon", mode)} role="img" aria-label={label} />;
}
