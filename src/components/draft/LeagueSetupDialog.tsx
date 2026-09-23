"use client";

import { useEffect, useMemo, useState } from "react";
import { DATASET_ID, LEAGUE_PRESETS } from "@/lib/data";
import { draftAtFields, draftCountdown, toDraftAt } from "@/lib/draft/draftDay";
import { leagueChanged, MAX_TEAMS, MIN_TEAMS, rosterFromCounts, SLOT_DEFS, slotCounts, validateLeague } from "@/lib/draft/league";
import { formatRoundPick, totalPicks } from "@/lib/draft/snake";
import type { Dataset, LeagueSettings, ScoringFormat } from "@/lib/draft/types";
import { MAX_LEAGUE_NAME } from "@/lib/storage";
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
 * League settings: name, preset, team count, draft slot, scoring, roster slots and Value/Reach threshold.
 * "create" makes a new league (and opens automatically on first run); "edit" changes the open one.
 * Saving a league that changes the draft's shape resets logged picks (after confirming).
 */
export function LeagueSetupDialog({ dataset, onClose, mode, firstRun }: { dataset: Dataset; onClose(): void; mode: "create" | "edit"; firstRun: boolean }) {
  const { league, leagues, active, updateLeague, createLeague, deleteLeague } = useLeague();
  const draft = useDraft();
  const confirm = useConfirm();
  const toast = useToast();
  const creating = mode === "create";
  // A new league starts from the open league's settings (or the default league on first run).
  const [form, setForm] = useState<LeagueSettings>(league);
  const [name, setName] = useState(creating ? (leagues.length ? `League ${leagues.length + 1}` : "My league") : (active?.name ?? ""));
  // Draft day, as the form holds it: a local date and an optional local time (see draftDay.ts).
  const [day, setDay] = useState(() => draftAtFields(creating ? null : active?.draftAt));
  const draftAt = toDraftAt(day.date, day.time);
  // Read once per render, only to say a date is already behind us; it never blocks saving.
  const past = draftCountdown(draftAt, new Date())?.phase === "started";
  const pickCount = creating ? 0 : draft.state.picks.length;
  /** Logged picks reference players missing from the loaded data. */
  const stalePicks = useMemo(() => {
    if (creating || !active || active.datasetId === DATASET_ID) return false;
    const ids = new Set(dataset.players.map((p) => p.id));
    return draft.state.picks.some((p) => !ids.has(p.playerId));
  }, [creating, active, dataset, draft.state.picks]);

  useEffect(() => {
    if (firstRun) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstRun, onClose]);
  const counts = slotCounts(form.roster);
  const errors = validateLeague(form, dataset);
  if (!name.trim()) errors.unshift("Give the league a name.");

  const update = (patch: Partial<LeagueSettings>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      return { ...next, mySlot: clamp(next.mySlot, 1, next.teams) };
    });
  const setCount = (key: keyof typeof counts, n: number) => update({ roster: rosterFromCounts({ ...counts, [key]: clamp(n, 0, 12) }) });

  const save = async () => {
    if (errors.length) return;
    const trimmed = name.trim().slice(0, MAX_LEAGUE_NAME);
    if (creating) {
      createLeague(trimmed, form, draftAt);
      toast(`${trimmed} created`);
      onClose();
      return;
    }
    let reset = false;
    if (leagueChanged(league, form) && pickCount) {
      const ok = await confirm({
        message: `These settings change the draft order or roster, so your ${pickCount} logged pick${pickCount === 1 ? "" : "s"} will be cleared. Continue?`,
        confirmLabel: "Save and reset draft",
        danger: true,
      });
      if (!ok) return;
      draft.reset();
      reset = true;
    }
    // Picks still on the board were logged against the league's original data; an empty draft now matches this data.
    updateLeague({ name: trimmed, settings: form, draftAt, datasetId: reset || !pickCount ? DATASET_ID : (active?.datasetId ?? DATASET_ID) });
    toast("League settings saved");
    onClose();
  };

  const remove = async () => {
    if (!active) return;
    const ok = await confirm({
      message: `Delete ${active.name}${pickCount ? ` and its ${pickCount} logged pick${pickCount === 1 ? "" : "s"}` : ""}? This can't be undone.`,
      confirmLabel: "Delete league",
      danger: true,
    });
    if (!ok) return;
    deleteLeague(active.id);
    toast(`${active.name} deleted`);
    onClose();
  };

  return (
    <>
      <div className={s.scrim} onClick={firstRun ? undefined : onClose} />
      <div className={s.setup} role="dialog" aria-modal="true" aria-labelledby="league-setup-title">
        <div className={s.setupHead}>
          <b id="league-setup-title">{firstRun ? "Set up your league" : creating ? "New league" : "League settings"}</b>
          {!firstRun && (
            <button className={s.btn} onClick={onClose}>
              Close
            </button>
          )}
        </div>
        <div className={s.setupBody}>
          {firstRun && <p className={s.setupIntro}>Tell the war room about your draft. You can change this any time from the League button.</p>}

          <label className={s.field}>
            <span className={s.fieldLabel}>Name</span>
            <input className={s.input} type="text" value={name} maxLength={MAX_LEAGUE_NAME} onChange={(e) => setName(e.target.value)} autoFocus={creating} />
          </label>

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

          <div className={s.field}>
            <span className={s.fieldLabel}>
              Draft day
              <small>optional</small>
            </span>
            <div className={s.draftDay}>
              <input
                className={s.input}
                type="date"
                aria-label="Draft date"
                value={day.date}
                onChange={(e) => setDay((d) => ({ date: e.target.value, time: e.target.value ? d.time : "" }))}
              />
              <input
                className={s.input}
                type="time"
                aria-label="Draft time (optional)"
                value={day.time}
                disabled={!day.date}
                onChange={(e) => setDay((d) => ({ ...d, time: e.target.value }))}
              />
              {day.date && (
                <button type="button" className={s.textBtn} onClick={() => setDay({ date: "", time: "" })}>
                  Clear
                </button>
              )}
              <small className={cx("draftDayNote", past && "warn")}>
                {past ? "That's already passed. Fine if you're logging an old draft." : "Adds a countdown, and a reminder of how close it is when you sign out."}
              </small>
            </div>
          </div>

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
          <span className={s.lbl}>
            Player data: {dataset.label}
            {stalePicks && <span className={s.staleNote}> · some logged picks are for players missing from this data</span>}
          </span>
          {!creating && active && (
            <button className={cx("btn", "danger")} onClick={() => void remove()}>
              Delete league
            </button>
          )}
          <button className={cx("btn", "primary")} onClick={() => void save()} disabled={errors.length > 0}>
            {firstRun ? "Start drafting" : creating ? "Create league" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
