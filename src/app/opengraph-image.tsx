import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { seasonSample } from "@/lib/landing/sample";
import { landingMode } from "@/lib/landing/seasonSample";

/** Generic, because the image follows the door: the draft card in the offseason, the season card in season (APE-340). */
export const alt = "Draft Room, your fantasy football analyst";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Position hues, straight off the board. Colors are literals here because satori has no CSS tokens. */
const POS = [
  ["QB", "#e5484d"],
  ["RB", "#3ddc91"],
  ["WR", "#4f9cf9"],
  ["TE", "#f59e42"],
  ["K", "#b39ddb"],
  ["DST", "#9aa7b8"],
] as const;

/** The card, as a share preview: the dim ground, the six rails, one line of argument. */
export default async function OpengraphImage() {
  // Per request, like the page: the preview has to change when the season starts, not at the next build.
  await connection();
  if (landingMode(config.landingMode, config.espnSeasonEnabled, Date.now(), seasonSample.window) === "season") return seasonCard();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#1a1e25",
          color: "#e7ebf0",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {POS.map(([label, color]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", border: "1px solid #323a45", borderRadius: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: color }} />
              <div style={{ fontSize: 18, color: "#8f9aa8", letterSpacing: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#8f9aa8", marginBottom: 16 }}>Every draft tool tells you who&apos;s available.</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            <div style={{ display: "flex" }}>This one tells you who&apos;ll still be</div>
            <div style={{ display: "flex", color: "#9be1ff" }}>there at your next turn.</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #323a45", paddingTop: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 600 }}>Draft Room</div>
          <div style={{ fontSize: 22, color: "#5f6a78" }}>draftroom.online</div>
        </div>
      </div>
    ),
    size,
  );
}

/** The season's card: a swap Draft Room made, the promise, and the season's green. */
function seasonCard() {
  const swap = seasonSample.swaps[0];
  const gain = (swap.in.proj - swap.out.proj).toFixed(1);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#1a1e25",
          color: "#e7ebf0",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24 }}>
          <div style={{ display: "flex", padding: "6px 12px", color: "#3ddc91", background: "rgba(61, 220, 145, 0.12)", border: "1px solid rgba(61, 220, 145, 0.5)", borderRadius: 6, fontWeight: 700 }}>
            +{gain}
          </div>
          <div style={{ display: "flex", color: "#8f9aa8" }}>
            Start&nbsp;<span style={{ color: "#3ddc91", fontWeight: 700 }}>{swap.in.name}</span>&nbsp;over&nbsp;
            <span style={{ textDecoration: "line-through" }}>{swap.out.name}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#8f9aa8", marginBottom: 16 }}>You play to win the game.</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            <div style={{ display: "flex" }}>We make sure you start</div>
            <div style={{ display: "flex", color: "#3ddc91" }}>the team that does.</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #323a45", paddingTop: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 600 }}>Draft Room</div>
          <div style={{ fontSize: 22, color: "#5f6a78" }}>Lineups, trades and pickups for your ESPN league</div>
        </div>
      </div>
    ),
    size,
  );
}
