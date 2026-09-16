/**
 * Generates one AI plan and prints it for review, next to the prototype's hand-written PLAN when
 * the league matches the prototype's (12 teams, slot 1, full PPR, 16 rounds). This is how prompt
 * changes are judged before anything is gated behind payment.
 *
 *   npm run ai:eval                                   12 teams, slot 1, default provider/model
 *   npm run ai:eval -- --teams 10 --slot 5            another league shape
 *   npm run ai:eval -- --provider anthropic --model claude-sonnet-5
 *   npm run ai:eval -- --dry-run                      print the prompt; no API call
 *   npm run ai:eval -- --effort high                   reasoning effort: low, medium (default) or high
 *   npm run ai:eval -- --timeout 600                  seconds to wait (default 300; models that think are slow)
 *   npm run ai:eval -- --out plan.json                also save the input summary, plan and usage
 *
 * Every run without --dry-run makes a paid API call.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DEFAULT_PLAN_EFFORT, generateAiPlan } from "@/lib/ai/generatePlan";
import { buildPlanInput, type PlanInput } from "@/lib/ai/planInput";
import { buildPlanPrompt } from "@/lib/ai/prompt";
import { createPlanModel, isPlanProvider } from "@/lib/ai/providers";
import { PlanModelError, type ModelEffort } from "@/lib/ai/provider";
import { validateDataset } from "@/lib/data/loadDataset";
import { DEFAULT_LEAGUE } from "@/lib/data/presets";
import { validateLeague } from "@/lib/draft/league";
import { mulberry32 } from "@/lib/draft/sim";
import { POSITIONS, type LeagueSettings, type ScoringFormat } from "@/lib/draft/types";
import { apiKeyFor, env } from "./env.mjs";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (flag: string, fallback: number) => Number(valueOf(flag) ?? fallback);

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const dataset = validateDataset(JSON.parse(readFileSync(valueOf("--dataset") ?? "src/lib/data/sample-2026.json", "utf8")));
const league: LeagueSettings = {
  ...DEFAULT_LEAGUE,
  teams: num("--teams", DEFAULT_LEAGUE.teams),
  mySlot: num("--slot", DEFAULT_LEAGUE.mySlot),
  scoring: (valueOf("--scoring") as ScoringFormat | undefined) ?? DEFAULT_LEAGUE.scoring,
};
const leagueErrors = validateLeague(league, dataset);
if (leagueErrors.length) fail(leagueErrors.join("\n  "));

const started = performance.now();
const input = buildPlanInput(league, dataset, { n: num("--mocks", 300), rng: mulberry32(num("--seed", 2026)) });
console.log(`built input: ${input.turns.length} turns, ${input.refs.size} candidates, ${input.mocks} mocks in ${Math.round(performance.now() - started)} ms`);

if (has("--dry-run")) {
  const { system, user } = buildPlanPrompt(input);
  console.log(`\n--- system (${system.length} chars) ---\n${system}\n\n--- user (${user.length} chars) ---\n${user}`);
  process.exit(0);
}

const provider = valueOf("--provider") ?? env.provider ?? "anthropic";
if (!isPlanProvider(provider)) fail(`Unknown AI provider "${provider}"`);
let model;
try {
  model = createPlanModel(provider, { apiKey: apiKeyFor(provider), model: valueOf("--model") ?? env.model });
} catch (err) {
  fail((err as Error).message);
}
const effort = (valueOf("--effort") ?? DEFAULT_PLAN_EFFORT) as ModelEffort;
if (!["low", "medium", "high"].includes(effort)) fail(`--effort must be low, medium or high`);
console.log(`generating with ${model.provider}/${model.model} at ${effort} effort…`);

let generated;
const requested = performance.now();
try {
  generated = await generateAiPlan(model, input, { effort, signal: AbortSignal.timeout(num("--timeout", 300) * 1000) });
} catch (err) {
  const after = `after ${((performance.now() - requested) / 1000).toFixed(1)} s`;
  if (err instanceof PlanModelError) fail(`${err.kind} ${after}: ${err.message}${err.usage ? ` (${err.usage.inputTokens} in / ${err.usage.outputTokens} out)` : ""}`);
  throw err;
}

const { plan, issues, usage, durationMs } = generated;
const candidate = (turn: PlanInput["turns"][number], id: string) => turn.candidates.find((c) => c.player.id === id)!;
const prototype = prototypePlan(input);

console.log(`\n${plan.intro}`);
for (const turn of plan.turns) {
  const t = input.turns.find((x) => x.picks[0] === turn.picks[0])!;
  const list = (ids: string[]) => ids.map((id) => ((c) => `${c.player.name} (${c.player.pos}, ${Math.round(c.odds * 100)}%)`)(candidate(t, id))).join(" · ") || "—";
  console.log(`\npicks ${turn.picks.join(" & ")}\n  ${turn.note}\n  take:      ${list(turn.take)}\n  targets:   ${list(turn.targets)}\n  fallbacks: ${list(turn.fallbacks)}\n  let go:    ${list(turn.letGo)}`);

  const proto = prototype?.get(turn.picks[0]);
  if (proto) {
    const aiNames = new Set([...turn.targets, ...turn.fallbacks].map((id) => candidate(t, id).player.name));
    const protoNames = [...proto.targets, ...proto.alts];
    const shared = protoNames.filter((n) => aiNames.has(n));
    const clash = proto.avoid.filter((n) => turn.targets.some((id) => candidate(t, id).player.name === n));
    console.log(`  prototype: ${proto.targets.join(", ")} | shared ${shared.length}/${protoNames.length}${clash.length ? ` | targets its let-go: ${clash.join(", ")}` : ""}`);
  }
}
const byId = new Map(dataset.players.map((p) => [p.id, p]));
const roster = plan.turns.flatMap((t) => t.take).map((id) => byId.get(id)!);
console.log(`\nmodel roster (${roster.length}/${league.roster.length} picks): ${roster.map((p) => `${p.name} ${p.pos}`).join(", ")}`);
console.log(`by position: ${POSITIONS.map((pos) => `${pos} ${roster.filter((p) => p.pos === pos).length}`).join(" · ")}`);
if (issues.length) console.log(`\nvalidation issues (${issues.length}):\n  ${issues.join("\n  ")}`);
console.log(`\n${usage.inputTokens} input + ${usage.cachedInputTokens ?? 0} cached / ${usage.outputTokens} output tokens, ${(durationMs / 1000).toFixed(1)} s`);

const out = valueOf("--out");
if (out) {
  writeFileSync(out, JSON.stringify({ league, provider: model.provider, model: model.model, usage, durationMs, issues, plan }, null, 2));
  console.log(`saved ${out}`);
}

/** The prototype's hand-written PLAN by first pick, when this league is the one it was written for. */
function prototypePlan(from: PlanInput): Map<number, { targets: string[]; alts: string[]; avoid: string[] }> | null {
  const html = readFileSync("prototype/war_room.html", "utf8");
  const start = html.indexOf("const PLAN=[");
  const end = html.indexOf("\n];", start);
  if (start < 0 || end < 0) return null;
  const entries = runInNewContext(`(${html.slice(html.indexOf("[", start), end + 2)})`) as { picks: number[]; targets: string[]; alts: string[]; avoid: string[] }[];
  const samePicks = JSON.stringify(entries.map((e) => e.picks)) === JSON.stringify(from.turns.map((t) => t.picks));
  return samePicks && from.league.scoring === "ppr" ? new Map(entries.map((e) => [e.picks[0], e])) : null;
}
