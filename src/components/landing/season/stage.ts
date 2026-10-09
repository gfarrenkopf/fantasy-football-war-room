"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll staging for the season page's sections (APE-340). Each section plays its own payoff once,
 * as it comes into view: the swaps land, the totals count, the win chance climbs past 50%.
 *
 * The page renders finished. Only a section still below the fold, with motion allowed, is armed
 * (`data-stage="armed"`, the CSS's starting frame) and then played (`data-stage="play"`) when it
 * scrolls in, so no script, reduced motion, or a section already on screen all show the end state.
 */
export function stageOnScroll(el: HTMLElement, onPlay: () => void): (() => void) | undefined {
  if (typeof IntersectionObserver === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (el.getBoundingClientRect().top < innerHeight * 0.8) return;
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      onPlay();
    },
    { rootMargin: "0px 0px -22% 0px" },
  );
  io.observe(el);
  return () => io.disconnect();
}

/** A section that arms below the fold and plays when it scrolls in. */
export function useStage<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = stageOnScroll(el, () => (el.dataset.stage = "play"));
    if (stop) el.dataset.stage = "armed";
    return stop;
  }, []);
  return ref;
}
