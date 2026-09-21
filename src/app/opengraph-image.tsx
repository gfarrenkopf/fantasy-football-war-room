import { ImageResponse } from "next/og";

export const alt = "Fantasy War Room — know who survives to your next turn";
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
export default function OpengraphImage() {
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
          <div style={{ fontSize: 26, fontWeight: 600 }}>Fantasy War Room</div>
          <div style={{ fontSize: 22, color: "#5f6a78" }}>draftroom.online</div>
        </div>
      </div>
    ),
    size,
  );
}
