"use client";

import { useEffect, useState } from "react";
import { LEAGUE_PRESETS } from "@/lib/data";
import { leagueChanged, MAX_TEAMS, MIN_TEAMS, rosterFromCounts, SLOT_DEFS, slotCounts, validateLeague } from "@/lib/draft/league";
import { formatRoundPick, totalPicks } from "@/lib/draft/snake";
import type { Dataset, LeagueSettings, ScoringFormat } from "@/lib/draft/types";
import { cx, s } from "./cx";
import { useDraft } from "./DraftProvider";
import { useConfirm, useToast } from "./Feedback";
import { useLeague } from "./LeagueProvider";

const SCORING: { value: ScoringFormat; label: string }[] = [
  { value: "ppr", label: "Full PPR" },
  { value: "half", label: "Half PPR" },
  { value: "std", label: "Standard" },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * League settings: preset, team count, draft slot, scoring, roster slots and Value/Reach threshold.
 * Opens automatically on first run. Saving a league that changes the draft's shape resets logged picks (after confirming).
 */
export function LeagueSetupDialog({ dataset, onClose, firstRun }: { dataset: Dataset; onClose(): void; firstRun: boolean }) {
  const { league, saveLeague } = useLeague();
  const draft = useDraft();
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<LeagueSettings>(league);

  useEffect(() => {
    if (firstRun) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstRun, onClose]);
  const counts = slotCounts(form.roster);
  const errors = validateLeague(form, dataset);

  const update = (patch: Partial<LeagueSettings>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      return { ...next, mySlot: clamp(next.mySlot, 1, next.teams) };
    });
  const setCount = (key: keyof typeof counts, n: number) => update({ roster: rosterFromCounts({ ...counts, [key]: clamp(n, 0, 12) }) });

  const save = async () => {
    if (errors.length) return;
    if (leagueChanged(league, form) && draft.state.picks.length) {
      const ok = await confirm({
        message: `These settings change the draft order or roster, so your ${draft.state.picks.length} logged pick${draft.state.picks.length === 1 ? "" : "s"} will be cleared. Continue?`,
        confirmLabel: "Save and reset draft",
        danger: true,
      });
      if (!ok) return;
      draft.reset();
    }
    saveLeague(form);
    toast("League settings saved");
    onClose();
  };

  return (
    <>
      <div className={s.scrim} onClick={firstRun ? undefined : onClose} />
      <div className={s.setup} role="dialog" aria-modal="true" aria-labelledby="league-setup-title">
        <div className={s.setupHead}>
          <b id="league-setup-title">{firstRun ? "Set up your league" : "League settings"}</b>
          {!firstRun && (
            <button className={s.btn} onClick={onClose}>
              Close
            </button>
          )}
        </div>
        <div className={s.setupBody}>
          {firstRun && <p className={s.setupIntro}>Tell the war room about your draft. You can change this any time from the League button.</p>}

          <div className={s.field}>
            <span className={s.fieldLabel}>Preset</span>
            <div className={s.seg}>
              {LEAGUE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={cx(form.teams === p.league.teams && !leagueChanged({ ...p.league, mySlot: form.mySlot }, form) && "on")}
                  onClick={() => update({ teams: p.league.teams, roster: p.league.roster, scoring: p.league.scoring })}
                >
                  {p.league.teams} teams
                </button>
              ))}
            </div>
          </div>

          <label className={s.field}>
            <span className={s.fieldLabel}>Teams</span>
            <select className={s.input} value={form.teams} onChange={(e) => update({ teams: Number(e.target.value) })}>
              {Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className={s.field}>
            <span className={s.fieldLabel}>Your draft slot</span>
            <select className={s.input} value={form.mySlot} onChange={(e) => update({ mySlot: Number(e.target.value) })}>
              {Array.from({ length: form.teams }, (_, i) => i + 1).map((slot) => (
                <option key={slot} value={slot}>
                  {slot} (pick {formatRoundPick(slot, form.teams)})
                </option>
              ))}
            </select>
          </label>

          <label className={s.field}>
            <span className={s.fieldLabel}>Scoring</span>
            <select className={s.input} value={form.scoring} onChange={(e) => update({ scoring: e.target.value as ScoringFormat })}>
              {SCORING.map((o) => (
                <option key={o.value} value={o.value} disabled={!dataset.scoring.includes(o.value)}>
                  {o.label}
                  {dataset.scoring.includes(o.value) ? "" : " (not in this player data)"}
                </option>
              ))}
            </select>
          </label>

          <div className={s.field}>
            <span className={s.fieldLabel}>
              Roster
              <small>
                {form.roster.length} rounds · {totalPicks(form)} picks
              </small>
            </span>
            <div className={s.slotGrid}>
              {SLOT_DEFS.map((d) => (
                <div key={d.key} className={s.stepper}>
                  <span>{d.label}</span>
                  <button aria-label={`Remove a ${d.label} slot`} onClick={() => setCount(d.key, counts[d.key] - 1)} disabled={counts[d.key] === 0}>
                    −
                  </button>
                  <b aria-label={`${d.label} slots`}>{counts[d.key]}</b>
                  <button aria-label={`Add a ${d.label} slot`} onClick={() => setCount(d.key, counts[d.key] + 1)}>
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label className={s.field}>
            <span className={s.fieldLabel}>
              Value/Reach threshold
              <small>spots between ADP and expert rank</small>
            </span>
            <input
              className={s.input}
              type="number"
              min={1}
              max={50}
              value={form.valueThreshold}
              onChange={(e) => update({ valueThreshold: Number(e.target.value) })}
            />
          </label>

          {errors.length > 0 && (
            <ul className={s.errors} role="alert">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <div className={s.setupFoot}>
          <span className={s.lbl}>Player data: {dataset.label}</span>
          <button className={cx("btn", "primary")} onClick={() => void save()} disabled={errors.length > 0}>
            {firstRun ? "Start drafting" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
