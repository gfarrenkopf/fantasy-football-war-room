/**
 * Prints what AI plans cost over a date range, from the ai_generations log: the average cost per
 * league (to check against the $15–20 price) plus a breakdown by outcome and model.
 *
 *   npm run ai:costs                                  the last 30 days
 *   npm run ai:costs -- --from 2026-09-01             from a date (UTC) until now
 *   npm run ai:costs -- --from 2026-09-01 --to 2026-10-01   `to` is exclusive
 *   npm run ai:costs -- --json                        machine-readable
 *
 * Reads DATABASE_URL from .env.local. On the droplet, see docs/deployment.md.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@/lib/db/schema";
import { costReport } from "@/lib/server/aiCosts";
import { env } from "./env.mjs";

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function date(flag: string, fallback: Date): Date {
  const raw = valueOf(flag);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) fail(`${flag} "${raw}" isn't a date (use YYYY-MM-DD)`);
  return parsed;
}

if (!env.databaseUrl) fail("DATABASE_URL is not set. Put it in .env.local; see docs/database.md.");
const to = date("--to", new Date());
const from = date("--from", new Date(to.getTime() - 30 * 24 * 60 * 60_000));
if (from >= to) fail("--from must be before --to");

const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 1 });
try {
  const report = await costReport(drizzle(pool, { schema }), { from, to });
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(n < 1 ? 4 : 2)}`);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    console.log(`AI plan costs ${day(from)} → ${day(to)} (UTC, end exclusive)\n`);
    console.log(`  leagues            ${report.leagues}`);
    console.log(`  model calls        ${report.generations}${report.unpriced ? ` (${report.unpriced} unpriced, not in totals)` : ""}`);
    console.log(`  total              ${usd(report.totalUsd)}`);
    console.log(`  avg per league     ${usd(report.avgUsdPerLeague)}`);
    console.log(`  avg per call       ${usd(report.avgUsdPerGeneration)}`);
    const outcomes = Object.entries(report.outcomes).sort((a, b) => b[1] - a[1]);
    if (outcomes.length) console.log(`\n  outcomes           ${outcomes.map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    for (const m of report.models) {
      console.log(
        `\n  ${m.provider}/${m.model}: ${m.generations} calls, ${usd(m.totalUsd)}, avg ${m.avgInputTokens} in / ${m.avgOutputTokens} out tokens (max out ${m.maxOutputTokens})`,
      );
    }
  }
} catch (error) {
  fail(`Couldn't read ai_generations: ${error instanceof Error ? error.message : error}. Has \`npm run db:migrate\` run?`);
} finally {
  await pool.end();
}
