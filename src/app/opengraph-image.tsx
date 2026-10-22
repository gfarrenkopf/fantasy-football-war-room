import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { dataset, DEFAULT_LEAGUE } from "@/lib/data";
import { computeTurnPlan, createSimContext, defaultRoom, mulberry32, simulateFrom, survivalOdds, type PlanEntry } from "@/lib/draft/sim";
import { seasonSample } from "@/lib/landing/sample";
import { callsWorth, landingMode } from "@/lib/landing/seasonSample";

/**
 * The first thing most people see of Draft Room: a link previewed in a group chat, about 360 points
 * wide (APE-414). It follows the door, as the landing page does: in season, "You play to win the
 * game." set as a poster beside the week the visitor wins; out of season, the turn plan's promise
 * beside a real one. Everything is sized for that thumbnail, so nothing on it is under 18px.
 *
 * Satori has no CSS tokens and no variable fonts, so colors are the design tokens' literals and the
 * faces are static instances committed in assets/og (SIL OFL 1.1): Big Shoulders at 900, the
 * product's stage face, and Geist for everything set small.
 */

export const alt = "Draft Room, your fantasy football analyst";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const C = {
  bg: "#1a1e25",
  panel: "#22272f",
  panel2: "#282e37",
  line2: "#3d4654",
  rowLine: "#2a3039",
  text: "#e7ebf0",
  muted: "#8f9aa8",
  dim: "#5f6a78",
  mine: "#3ddc91",
  valueInk: "#5ee39a",
  reachInk: "#ff8a8a",
  warn: "#fbbf24",
  sky: "#9be1ff",
  gold: "#e8c46a",
};

const POS: Record<string, string> = { QB: "#e255c1", RB: "#0bccd7", WR: "#4f9cf9", TE: "#f59e42", K: "#b39ddb", DST: "#9aa7b8" };

const font = (file: string) => readFile(join(process.cwd(), "assets/og", file));
const fonts = Promise.all([font("BigShoulders-Black.ttf"), font("Geist-Medium.ttf"), font("Geist-SemiBold.ttf"), font("Geist-Bold.ttf")]).then(
  ([stage, medium, semibold, bold]) => [
    { name: "Stage", data: stage, weight: 900 as const, style: "normal" as const },
    { name: "Geist", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
    { name: "Geist", data: bold, weight: 700 as const, style: "normal" as const },
  ],
);

const one = (n: number) => n.toFixed(1);
const CALLS: Record<number, string> = { 1: "one call", 2: "two calls", 3: "three calls" };
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

export default async function OpengraphImage() {
  // Per request, like the page: the preview has to change when the season starts, not at the next build.
  await connection();
  const season = landingMode(config.landingMode, config.espnSeasonEnabled, Date.now(), seasonSample.window) === "season";
  return new ImageResponse(season ? <SeasonCard /> : <DraftCard />, { ...size, fonts: await fonts });
}

/**
 * The ground both cards share: the room's dark, a field's yard lines fading in toward the card,
 * and one pool of light, in the card's color, behind it.
 */
function Frame({ light, children }: { light: string; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.bg, color: C.text, fontFamily: "Geist" }}>
      {/* Yard lines: every five yards across the right of the field, brighter toward the card. */}
      <div style={{ position: "absolute", inset: 0, display: "flex" }}>
        {Array.from({ length: 13 }, (_, i) => (
          <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: 540 + i * 56, width: i % 2 ? 1 : 2, background: rgba("#ffffff", 0.03 + i * 0.004) }} />
        ))}
      </div>
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 80% 46%, ${rgba(light, 0.2)} 0%, ${rgba(light, 0.06)} 30%, transparent 58%)` }} />
      {/* The left stays the room's dark, so the headline sits on calm ground. */}
      <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `linear-gradient(90deg, ${C.bg} 0%, ${C.bg} 38%, ${rgba(C.bg, 0)} 62%)` }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", padding: "54px 60px" }}>{children}</div>
    </div>
  );
}

function Wordmark({ tag }: { tag?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", fontFamily: "Stage", fontSize: 40, lineHeight: 1, letterSpacing: 1, color: C.text }}>DRAFT ROOM</div>
      {tag && (
        <div style={{ display: "flex", padding: "5px 10px 4px", fontSize: 17, fontWeight: 700, letterSpacing: 2.5, color: C.gold, border: `1.5px solid ${rgba(C.gold, 0.6)}`, background: rgba(C.gold, 0.1), borderRadius: 6 }}>
          {tag}
        </div>
      )}
    </div>
  );
}

/** One line of the poster headline. `glow` lights the word the card is about. */
function Line({ children, size: px }: { children: React.ReactNode; size: number }) {
  return <div style={{ display: "flex", fontFamily: "Stage", fontSize: px, lineHeight: 0.86, letterSpacing: 0.5, color: C.text }}>{children}</div>;
}

const lit = (color: string): React.CSSProperties => ({ color, textShadow: `0 0 34px ${rgba(color, 0.55)}` });

// ------------------------------------------------------------------ in season

function SeasonCard() {
  const s = seasonSample;
  const worth = callsWorth(s.swaps);
  return (
    <Frame light={C.mine}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640, height: 522 }}>
        <Wordmark tag="EXCLUSIVE" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Line size={130}>YOU PLAY</Line>
          <Line size={130}>
            TO&nbsp;<span style={lit(C.mine)}>WIN</span>
          </Line>
          <Line size={130}>THE GAME.</Line>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26, fontSize: 32, fontWeight: 600, lineHeight: 1.18, letterSpacing: -0.6 }}>
            <div style={{ display: "flex", color: C.text }}>We make sure you start</div>
            <div style={{ display: "flex", color: C.mine }}>the team that does.</div>
          </div>
        </div>
      </div>

      {/* The week already won, tilted as if dealt onto the table. */}
      <div
        style={{
          position: "absolute",
          top: 62,
          left: 704,
          width: 452,
          display: "flex",
          flexDirection: "column",
          background: C.panel,
          border: `1.5px solid ${rgba(C.mine, 0.55)}`,
          borderRadius: 18,
          transform: "rotate(-3deg)",
          boxShadow: `0 28px 60px rgba(0, 0, 0, 0.55), 0 0 90px ${rgba(C.mine, 0.16)}`,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "30px 26px 22px", backgroundImage: `radial-gradient(circle at 50% 0%, ${rgba(C.mine, 0.2)} 0%, transparent 70%)` }}>
          <div style={{ display: "flex", fontFamily: "Stage", fontSize: 100, lineHeight: 0.84, letterSpacing: 1, whiteSpace: "nowrap", ...lit(C.mine) }}>YOU WON</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 14, fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>
            <span style={{ color: C.text }}>{one(s.final.you)}</span>
            <span style={{ color: C.dim, fontWeight: 500 }}>–</span>
            <span style={{ color: C.muted }}>{one(s.final.opponent)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 20px" }}>
          {s.swaps.map((sw) => (
            <div key={sw.in.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 10, background: rgba(C.mine, 0.09) }}>
              <div style={{ display: "flex", flexShrink: 0, justifyContent: "center", width: 58, padding: "5px 0", fontSize: 16, fontWeight: 700, color: POS[sw.in.pos], background: rgba(POS[sw.in.pos], 0.14), borderRadius: 6 }}>
                {s.lineup[sw.slot].slot}
              </div>
              <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3 }}>
                <div style={{ display: "flex", fontSize: 21, fontWeight: 600, color: C.muted }}>
                  Started&nbsp;<span style={{ color: C.mine, fontWeight: 700 }}>{sw.in.name}</span>
                </div>
                <div style={{ display: "flex", fontSize: 17, fontWeight: 500, color: C.dim }}>
                  over {sw.out.name}&nbsp;·&nbsp;<span style={{ color: C.reachInk, fontWeight: 700 }}>{one(sw.points.out)}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexShrink: 0, fontSize: 32, fontWeight: 700, letterSpacing: -1, color: C.mine }}>{one(sw.points.in)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "18px 20px 0", padding: "16px 4px 24px", borderTop: `1px solid ${C.rowLine}` }}>
          <div style={{ display: "flex", flexShrink: 0, fontFamily: "Stage", fontSize: 60, lineHeight: 1, color: C.valueInk }}>+{one(worth)}</div>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, fontSize: 19, fontWeight: 500, lineHeight: 1.25, color: C.muted }}>
            <div style={{ display: "flex" }}>points from {CALLS[s.swaps.length] ?? `${s.swaps.length} calls`}.</div>
            <div style={{ display: "flex", color: C.text, fontWeight: 600 }}>Won by {one(s.final.you - s.final.opponent)}.</div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ out of season

/**
 * The war room's live turn plan for the landing page's default league, from its own mocks: the
 * same 100 the war room runs after every pick, seeded so the preview is the same every time it's
 * fetched. Null if the plan can't be made (a swapped dataset too small for the league).
 */
function samplePlan() {
  const league = DEFAULT_LEAGUE;
  const ctx = createSimContext(league, dataset.players);
  const room = defaultRoom(league.teams);
  const picks = simulateFrom([], room, ctx, { autoMe: true, rng: mulberry32(414) }).slice(0, league.mySlot);
  const odds = survivalOdds(picks, room, ctx, { n: 100, rng: mulberry32(425) });
  const plan = computeTurnPlan(picks, odds, ctx, 0);
  if (!plan) return null;
  // Who to plan on, then who to take if they're gone: the plan's first two bands, as the war room shows them.
  const rows = [...plan.targets.slice(0, 2), ...plan.fallbacks.slice(0, 2)].slice(0, 4);
  return rows.length ? { league, turn: plan.picks[0], rows } : null;
}

const oddsInk = (p: number) => (p >= 0.6 ? C.valueInk : p >= 0.3 ? C.warn : C.dim);

function DraftCard() {
  const plan = samplePlan();
  return (
    <Frame light={C.sky}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640, height: 522 }}>
        <Wordmark />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Line size={106}>WHO&apos;LL STILL</Line>
          <Line size={106}>BE THERE AT</Line>
          <Line size={106}>
            YOUR&nbsp;<span style={lit(C.sky)}>NEXT</span>
          </Line>
          <Line size={106}>
            <span style={lit(C.sky)}>TURN.</span>
          </Line>
          <div style={{ display: "flex", marginTop: 26, fontSize: 30, fontWeight: 600, letterSpacing: -0.6, color: C.muted }}>Every draft tool tells you who&apos;s available.</div>
        </div>
      </div>

      {plan && (
        <div
          style={{
            position: "absolute",
            top: 52,
            left: 704,
            width: 452,
            display: "flex",
            flexDirection: "column",
            background: C.panel,
            border: `1.5px solid ${rgba(C.sky, 0.45)}`,
            borderRadius: 18,
            transform: "rotate(-3deg)",
            boxShadow: `0 28px 60px rgba(0, 0, 0, 0.55), 0 0 90px ${rgba(C.sky, 0.14)}`,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", padding: "26px 26px 18px", backgroundImage: `radial-gradient(circle at 0% 0%, ${rgba(C.sky, 0.16)} 0%, transparent 70%)` }}>
            <div style={{ display: "flex", fontFamily: "Stage", fontSize: 72, lineHeight: 0.9, letterSpacing: 0.5, whiteSpace: "nowrap", ...lit(C.sky) }}>PICK {plan.turn}</div>
            <div style={{ display: "flex", marginTop: 10, fontSize: 19, fontWeight: 500, color: C.muted }}>
              Your next turn · {plan.league.teams} teams · {plan.league.scoring === "ppr" ? "PPR" : plan.league.scoring === "half" ? "Half PPR" : "Standard"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {plan.rows.map((r: PlanEntry) => (
              <div key={r.player.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 26px 13px 22px", borderTop: `1px solid ${C.rowLine}` }}>
                <div style={{ display: "flex", width: 4, height: 44, borderRadius: 2, background: POS[r.player.pos] }} />
                <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, gap: 2 }}>
                  <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: C.text }}>{r.player.name}</div>
                  <div style={{ display: "flex", fontSize: 17, fontWeight: 500, color: C.muted }}>
                    {r.player.pos} · {r.player.team}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 2, fontSize: 40, fontWeight: 700, letterSpacing: -1.5, color: oddsInk(r.survival) }}>
                  {Math.round(r.survival * 100)}
                  <span style={{ fontSize: 20, fontWeight: 600, color: C.muted }}>%</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", padding: "14px 26px 22px", borderTop: `1px solid ${C.rowLine}`, fontSize: 17, fontWeight: 500, color: C.dim }}>
            Odds he&apos;s still there, from 100 practice drafts.
          </div>
        </div>
      )}
    </Frame>
  );
}
