import { connection } from "next/server";
import { config } from "@/lib/config";

const positions = [
  { label: "QB", className: "border-qb text-qb" },
  { label: "RB", className: "border-rb text-rb" },
  { label: "WR", className: "border-wr text-wr" },
  { label: "TE", className: "border-te text-te" },
  { label: "K", className: "border-k text-k" },
  { label: "DST", className: "border-dst text-dst" },
];

function FeatureFlag({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={`inline-block size-2 rounded-full ${on ? "bg-mine" : "bg-dim"}`} />
      {label} <b className={on ? "text-mine" : "text-dim"}>{on ? "on" : "off"}</b>
    </span>
  );
}

export default async function Home() {
  // Render per request so flags reflect the runtime environment, not build-time env.
  await connection();

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3.5 py-2">
        <div className="flex flex-col leading-tight">
          <b className="text-[15px]">Fantasy War Room</b>
          <span className="text-[11px] text-muted">pre-alpha</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4">
        <section className="rounded-card border border-line bg-panel2 p-4">
          <h1 className="mb-3 text-muted">Design tokens</h1>
          <div className="flex flex-wrap gap-2">
            {positions.map((p) => (
              <span
                key={p.label}
                className={`rounded-card border px-2.5 py-1 font-bold ${p.className}`}
              >
                {p.label}
              </span>
            ))}
            <span className="rounded-card bg-value/20 px-2.5 py-1 font-bold text-value">
              Value
            </span>
            <span className="rounded-card bg-reach/20 px-2.5 py-1 font-bold text-reach">
              Reach
            </span>
            <span className="rounded-card bg-warn/20 px-2.5 py-1 font-bold text-warn">
              Bye conflict
            </span>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
          <span>Hosted features:</span>
          <FeatureFlag label="Sync" on={config.cloudEnabled} />
          <FeatureFlag label="AI plan" on={config.aiEnabled} />
          <FeatureFlag label="Payments" on={config.paymentsEnabled} />
          <FeatureFlag label="Live data" on={config.dataPipelineEnabled} />
        </section>
      </main>
    </>
  );
}
