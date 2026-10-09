"use client";

import { useEffect, useRef } from "react";
import { stageOnScroll } from "./stage";

/**
 * A number that counts to its value when its section scrolls in (expo-out). It renders the value,
 * so without the motion it's simply the number; armed, it shows `from` until it plays.
 */
export function Count({ value, from = 0, digits = 1, prefix = "", suffix = "", delay = 0, ms = 900 }: { value: number; from?: number; digits?: number; prefix?: string; suffix?: string; delay?: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const show = (n: number) => `${prefix}${n.toFixed(digits)}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (n: number) => `${prefix}${n.toFixed(digits)}${suffix}`;
    let raf = 0;
    let timer = 0;
    const stop = stageOnScroll(el, () => {
      timer = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / ms);
          el.textContent = fmt(t >= 1 ? value : from + (value - from) * (1 - Math.pow(2, -10 * t)));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }, delay);
    });
    if (stop) el.textContent = fmt(from);
    return () => {
      stop?.();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      el.textContent = fmt(value);
    };
  }, [value, from, digits, prefix, suffix, delay, ms]);

  return <span ref={ref}>{show(value)}</span>;
}
