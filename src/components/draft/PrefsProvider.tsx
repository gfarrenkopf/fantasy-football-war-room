"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CPU_STYLES } from "@/lib/draft/sim";
import type { UiPrefs } from "@/lib/draft/types";
import { getStores } from "@/lib/storage";

export const DEFAULT_PREFS: UiPrefs = { view: "focus", center: "ba", baMode: "pos", mockOn: false, room: null };

/** Accepts only well-formed prefs fields, falling back to defaults per field. */
export function parsePrefs(raw: unknown): UiPrefs {
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<UiPrefs>;
  return {
    view: p.view === "board" ? "board" : "focus",
    center: p.center === "plan" ? "plan" : "ba",
    baMode: p.baMode === "all" ? "all" : "pos",
    mockOn: p.mockOn === true,
    room: Array.isArray(p.room) && p.room.every((s) => CPU_STYLES.includes(s)) ? p.room : null,
  };
}

interface PrefsContextValue {
  prefs: UiPrefs;
  setPrefs(patch: Partial<UiPrefs>): void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

/** Per-device UI preferences (view, open panel, best-available mode, mock room), saved through the PrefsStore. */
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setState] = useState<UiPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStores()
      .prefs.getPrefs()
      .then((raw) => {
        if (cancelled) return;
        if (raw) setState(parsePrefs(raw));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) void getStores().prefs.savePrefs(prefs);
  }, [prefs, loaded]);

  const setPrefs = useCallback((patch: Partial<UiPrefs>) => setState((p) => ({ ...p, ...patch })), []);
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
