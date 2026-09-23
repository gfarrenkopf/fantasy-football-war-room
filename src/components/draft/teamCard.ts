import type { Position } from "@/lib/draft/types";
import type { DraftWrap, WrapPick } from "@/lib/draft/wrap";

/**
 * The keepsake from the draft-complete reveal: the user's team as a 1080×1350 poster (the 4:5
 * frame phones share best), drawn on a canvas in the stage's own face and colors. Nothing leaves
 * the device — it is shared through the OS sheet where there is one, otherwise downloaded.
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

export interface TeamCardMeta {
  season: number;
  league: string;
  teams: number;
  /** CSS font-family of the stage face (Big Shoulders via next/font). */
  stageFamily: string;
}

/** Any CSS color (hex, rgb, oklch, …) at an opacity, resolved through a 1×1 canvas so every browser can paint it. */
function alpha(color: string, a: number): string {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return color;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const label = (pos: Position) => (pos === "DST" ? "D/ST" : pos);

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws the poster and returns it as a PNG blob. */
export async function drawTeamCard(wrap: DraftWrap, meta: TeamCardMeta): Promise<Blob> {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const stage = meta.stageFamily;
  await Promise.all([document.fonts.load(`900 120px ${stage}`), document.fonts.load(`800 40px ${stage}`), document.fonts.load(`700 34px ${sans}`)]).catch(() => []);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const text = v("--color-text", "#e8ecf1");
  const muted = v("--color-muted", "#9aa4b2");
  const sky = v("--color-sky", "#8ec5ff");
  const mine = v("--color-mine", "#5fd08a");
  const mineInk = v("--color-mine-ink", "#0d1a14");
  const reach = v("--color-reach", "#e5534b");

  // The stage: dark, a sky glow rising from the floor, two follow-spots from the wings.
  const ground = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, H * 0.8);
  ground.addColorStop(0, "#11151b");
  ground.addColorStop(1, "#07090c");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);
  const floor = ctx.createRadialGradient(W / 2, H * 1.05, 20, W / 2, H * 1.05, W * 0.75);
  floor.addColorStop(0, alpha(sky, 0.18));
  floor.addColorStop(1, alpha(sky, 0));
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, W, H);
  for (const [x, lean] of [
    [-80, 1],
    [W + 80, -1],
  ] as const) {
    const beam = ctx.createLinearGradient(x, H, W / 2, 0);
    beam.addColorStop(0, "rgba(255,255,255,0.13)");
    beam.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(W / 2 - lean * 60, 0);
    ctx.lineTo(W / 2 + lean * 420, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Title block.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = sky;
  ctx.font = `800 40px ${stage}`;
  ctx.letterSpacing = "7px";
  ctx.fillText(`THE ${meta.season} DRAFT`, W / 2, 128);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = text;
  ctx.font = `900 150px ${stage}`;
  ctx.shadowColor = alpha(sky, 0.35);
  ctx.shadowBlur = 40;
  ctx.fillText("THAT'S A WRAP", W / 2, 262);
  ctx.shadowBlur = 0;
  ctx.fillStyle = muted;
  ctx.font = `600 30px ${sans}`;
  ctx.fillText(fit(ctx, `${meta.league} · ${meta.teams} teams`, W - PAD * 2), W / 2, 318);

  // The lineup.
  const top = 370;
  const headline = wrap.steal ?? wrap.best;
  const bottom = headline ? H - 300 : H - 130;
  const rowH = Math.min(64, (bottom - top) / Math.max(1, wrap.starters.length));
  ctx.textAlign = "left";
  wrap.starters.forEach((p, i) => row(p, top + i * rowH, rowH));

  function row(p: WrapPick, y: number, h: number) {
    const hue = v(POS_VAR[p.player.pos], text);
    const mid = y + h / 2;
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    roundRect(PAD, y + 4, W - PAD * 2, h - 8, 10);
    ctx.fill();
    ctx.fillStyle = alpha(hue, 0.2);
    roundRect(PAD + 12, mid - 17, 92, 34, 7);
    ctx.fill();
    ctx.fillStyle = hue;
    ctx.font = `800 24px ${stage}`;
    ctx.textAlign = "center";
    ctx.fillText(p.slot === "D/ST" ? "D/ST" : p.slot, PAD + 58, mid + 9);
    ctx.textAlign = "left";
    ctx.fillStyle = text;
    ctx.font = `700 ${Math.round(Math.min(34, h * 0.52))}px ${sans}`;
    ctx.fillText(fit(ctx, p.player.name, 520), PAD + 128, mid + 11);
    ctx.textAlign = "right";
    ctx.fillStyle = muted;
    ctx.font = `600 24px ${sans}`;
    ctx.fillText(`${label(p.player.pos)} · ${p.player.team} · ${p.roundPick}`, W - PAD - 118, mid + 9);
    if (p.gain !== null && p.gain !== 0) {
      ctx.fillStyle = p.gain > 0 ? mine : reach;
      ctx.font = `800 30px ${stage}`;
      ctx.fillText(`${p.gain > 0 ? "+" : ""}${p.gain}`, W - PAD - 20, mid + 11);
    }
    ctx.textAlign = "left";
  }

  // The headline pick, on the broadcast slab.
  if (headline) {
    const y = H - 270;
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.transform(1, 0, -0.16, 1, 0, 0);
    ctx.fillStyle = mine;
    ctx.fillRect(-330, -44, 660, 76);
    ctx.restore();
    ctx.fillStyle = mineInk;
    ctx.textAlign = "center";
    ctx.font = `900 54px ${stage}`;
    ctx.fillText(wrap.steal ? "STEAL OF THE DRAFT" : "BEST PICK", W / 2, y + 16);
    ctx.fillStyle = text;
    ctx.font = `900 76px ${stage}`;
    ctx.fillText(fit(ctx, headline.player.name.toUpperCase(), W - PAD * 2), W / 2, y + 116);
    ctx.fillStyle = muted;
    ctx.font = `600 28px ${sans}`;
    ctx.fillText(
      wrap.steal
        ? `Ranked ${ordinalOf(headline.player.consensusRank)} · taken ${ordinalOf(headline.player.pickNo)} · +${headline.gain} picks of value`
        : `Ranked ${ordinalOf(headline.player.consensusRank)} by consensus · taken ${headline.roundPick}`,
      W / 2,
      y + 162,
    );
  }

  // Foot.
  ctx.textAlign = "center";
  ctx.fillStyle = muted;
  ctx.font = `600 24px ${sans}`;
  const bench = wrap.bench.length ? `${wrap.bench.length} on the bench · ` : "";
  ctx.fillText(`${bench}${wrap.beat.k} of ${wrap.beat.n} picks beat consensus · Fantasy War Room`, W / 2, H - 44);

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the team card"))), "image/png"));
}

function ordinalOf(n: number) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
}

/** Shares the poster through the OS sheet where files can be shared (phones), otherwise downloads it. */
export async function saveTeamCard(blob: Blob, filename: string): Promise<"shared" | "saved" | "cancelled"> {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My draft" });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Share refused for another reason (e.g. no user activation left): fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}
