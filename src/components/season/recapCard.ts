import { useState } from "react";
import { stage } from "@/components/draft/stageFont";
import { alpha, fit, saveTeamCard } from "@/components/draft/teamCard";
import type { Position } from "@/lib/draft/types";
import type { WeekRecap } from "@/lib/season/recap";

/**
 * The week's keepsake (APE-230, APE-310): a 1080×1350 poster for the league's group chat, drawn on
 * the draft room's stage in its face and colors. A giant W, L or T, the final, the margin on the
 * slab, the starters as they scored, and the star of the week. A win is lit green; a loss is the same
 * stage with the lights down, a bright spot for its star, and a dry word at the foot. Nothing leaves
 * the device.
 */

const W = 1080;
const H = 1350;
const PAD = 72;

const POS_VAR: Record<Position, string> = {
  QB: "--color-qb",
  RB: "--color-rb",
  WR: "--color-wr",
  TE: "--color-te",
  K: "--color-k",
  DST: "--color-dst",
};

const SLOT: Record<string, string> = { DST: "D/ST", SUPERFLEX: "OP" };

/** The loss card's last word, by how it went. */
function shrug(margin: number): string {
  if (margin < 3) return "lost by a rounding error";
  if (margin >= 40) return "we don't talk about this one";
  return "every contender drops one";
}

export async function drawRecapCard(recap: WeekRecap, meta: { league: string; stageFamily: string }): Promise<Blob> {
  const win = recap.result === "win";
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const stage = meta.stageFamily;
  await Promise.all([document.fonts.load(`900 120px ${stage}`), document.fonts.load(`800 40px ${stage}`), document.fonts.load(`700 34px ${sans}`)]).catch(
    () => [],
  );

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const text = v("--color-text", "#e7ebf0");
  const muted = v("--color-muted", "#8f9aa8");
  const sky = v("--color-sky", "#9be1ff");
  const mine = v("--color-mine", "#3ddc91");
  const mineInk = v("--color-mine-ink", "#0d1a14");
  const reach = v("--color-reach-ink", "#ff8a8a");
  // A win is the user's night, in green; anything else plays under work lights.
  const tone = win ? mine : muted;
  const toneInk = win ? mineInk : "#0b0d10";

  // The stage, lit from the floor: green for a win.
  const ground = ctx.createRadialGradient(W / 2, H * 0.36, 40, W / 2, H * 0.36, H * 0.85);
  ground.addColorStop(0, win ? "#121a17" : "#14171b");
  ground.addColorStop(1, "#06080a");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);
  const floor = ctx.createRadialGradient(W / 2, H * 1.04, 20, W / 2, H * 1.04, W * 0.85);
  floor.addColorStop(0, alpha(tone, win ? 0.22 : 0.1));
  floor.addColorStop(1, alpha(tone, 0));
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, W, H);
  for (const [x, lean] of [
    [-80, 1],
    [W + 80, -1],
  ] as const) {
    const beam = ctx.createLinearGradient(x, H, W / 2, 0);
    beam.addColorStop(0, `rgba(255,255,255,${win ? 0.12 : 0.05})`);
    beam.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(W / 2 - lean * 60, 0);
    ctx.lineTo(W / 2 + lean * 420, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Week, the letter, the final.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = win ? sky : muted;
  ctx.font = `800 38px ${stage}`;
  ctx.letterSpacing = "8px";
  ctx.fillText(`WEEK ${recap.week} · FINAL`, W / 2, 112);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = tone;
  ctx.font = `900 300px ${stage}`;
  ctx.shadowColor = alpha(mine, 0.55);
  ctx.shadowBlur = win ? 60 : 0;
  ctx.fillText(win ? "W" : recap.result === "loss" ? "L" : "T", W / 2, 380);
  ctx.shadowBlur = 0;

  ctx.font = `900 108px ${stage}`;
  const mineScore = recap.me.toFixed(1);
  const theirScore = recap.them.toFixed(1);
  const gap = 70;
  const leftW = ctx.measureText(mineScore).width;
  const rightW = ctx.measureText(theirScore).width;
  const start = W / 2 - (leftW + gap + rightW) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = text;
  ctx.fillText(mineScore, start, 510);
  ctx.fillStyle = alpha(muted, 0.9);
  ctx.fillText(theirScore, start + leftW + gap, 510);
  ctx.fillStyle = alpha(muted, 0.6);
  ctx.font = `800 40px ${stage}`;
  ctx.textAlign = "center";
  ctx.fillText("–", start + leftW + gap / 2, 490);

  // The margin, on the broadcast slab.
  const slabY = 580;
  ctx.save();
  ctx.translate(W / 2, slabY);
  ctx.transform(1, 0, -0.16, 1, 0, 0);
  ctx.fillStyle = tone;
  ctx.fillRect(-250, -40, 500, 70);
  ctx.restore();
  ctx.fillStyle = toneInk;
  ctx.font = `900 52px ${stage}`;
  ctx.fillText(win ? `WON BY ${recap.margin.toFixed(1)}` : recap.result === "loss" ? `LOST BY ${recap.margin.toFixed(1)}` : "DEAD HEAT", W / 2, slabY + 16);
  ctx.fillStyle = muted;
  ctx.font = `600 28px ${sans}`;
  ctx.fillText(fit(ctx, `${win ? "over" : recap.result === "loss" ? "to" : "with"} ${recap.opponent} · ${meta.league}`, W - PAD * 2), W / 2, slabY + 76);

  // The starters as they scored.
  const top = 700;
  const bottom = recap.star ? H - 250 : H - 110;
  const rowH = Math.min(52, (bottom - top) / Math.max(1, recap.starters.length));
  const starId = recap.star?.player.playerId;
  recap.starters.forEach((p, i) => {
    const y = top + i * rowH;
    const mid = y + rowH / 2;
    const hue = v(POS_VAR[p.pos], text);
    const star = p.playerId === starId;
    ctx.fillStyle = star ? alpha(tone, 0.14) : "rgba(255,255,255,0.035)";
    ctx.beginPath();
    ctx.roundRect(PAD, y + 3, W - PAD * 2, rowH - 6, 9);
    ctx.fill();
    ctx.fillStyle = alpha(hue, 0.2);
    ctx.beginPath();
    ctx.roundRect(PAD + 10, mid - 15, 84, 30, 6);
    ctx.fill();
    ctx.fillStyle = hue;
    ctx.font = `800 22px ${stage}`;
    ctx.textAlign = "center";
    ctx.fillText(SLOT[p.slot] ?? p.slot, PAD + 52, mid + 8);
    ctx.textAlign = "left";
    ctx.fillStyle = text;
    ctx.font = `700 ${Math.round(Math.min(30, rowH * 0.56))}px ${sans}`;
    ctx.fillText(fit(ctx, p.name, 560), PAD + 112, mid + 10);
    ctx.textAlign = "right";
    ctx.fillStyle = p.points >= p.projected ? mine : p.points < p.projected * 0.7 ? reach : text;
    ctx.font = `900 34px ${stage}`;
    ctx.fillText(p.points.toFixed(1), W - PAD - 18, mid + 12);
    ctx.textAlign = "left";
  });

  // The star of the week.
  if (recap.star) {
    const { player, beat } = recap.star;
    const y = H - 196;
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.transform(1, 0, -0.16, 1, 0, 0);
    ctx.fillStyle = tone;
    ctx.fillRect(-290, -38, 580, 64);
    ctx.restore();
    ctx.fillStyle = toneInk;
    ctx.textAlign = "center";
    ctx.font = `900 46px ${stage}`;
    ctx.fillText(win ? "STAR OF THE WEEK" : "BRIGHT SPOT", W / 2, y + 14);
    ctx.fillStyle = text;
    ctx.font = `900 70px ${stage}`;
    ctx.fillText(fit(ctx, player.name.toUpperCase(), W - PAD * 2), W / 2, y + 104);
    ctx.fillStyle = muted;
    ctx.font = `600 27px ${sans}`;
    ctx.fillText(
      beat
        ? `${player.points.toFixed(1)} points · +${(player.points - player.projected).toFixed(1)} over ESPN's call`
        : `${player.points.toFixed(1)} points, the most of your starters`,
      W / 2,
      y + 148,
    );
  }

  ctx.textAlign = "center";
  ctx.fillStyle = alpha(muted, 0.8);
  ctx.font = `600 22px ${sans}`;
  ctx.fillText(recap.result === "loss" ? `Fantasy War Room · ${shrug(recap.margin)}` : "Fantasy War Room", W / 2, H - 28);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the recap card"))), "image/png"));
}

const RESULT_WORD = { win: "win", loss: "loss", tie: "tie" } as const;

/** Draws the week's card and hands it to the OS share sheet, or downloads it. */
export async function saveRecapCard(recap: WeekRecap, league: string): Promise<"shared" | "saved" | "cancelled"> {
  const blob = await drawRecapCard(recap, { league, stageFamily: stage.style.fontFamily });
  const slug =
    league
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "league";
  const word = RESULT_WORD[recap.result];
  return saveTeamCard(blob, `${slug}-week-${recap.week}-${word}.png`, `Week ${recap.week} ${word}`);
}

/** A save-the-card button's state and label: idle, drawing, saved, or failed and ready to retry. */
export function useRecapCard(recap: WeekRecap | null, league: string) {
  const [saving, setSaving] = useState<"idle" | "drawing" | "saved" | "failed">("idle");
  const keep = async () => {
    if (!recap || saving === "drawing") return;
    setSaving("drawing");
    const how = await saveRecapCard(recap, league).catch(() => "failed" as const);
    setSaving(how === "failed" ? "failed" : how === "cancelled" ? "idle" : "saved");
  };
  const idle = recap?.result === "win" ? "Save win card" : "Save recap card";
  const label = saving === "drawing" ? "Drawing…" : saving === "saved" ? "Card saved" : saving === "failed" ? "Couldn't save. Try again" : idle;
  return { keep: () => void keep(), drawing: saving === "drawing", label };
}
