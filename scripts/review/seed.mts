/**
 * Checks App Review's account (APE-398) before a submission: signs in as the reviewer the way the app
 * does, with REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_CODE, connects the ESPN test leagues, and lists
 * what the reviewer will see. Signing in connects them anyway; this says whether it worked.
 *
 *   npm run review:seed                                  against REVIEW_SERVER_URL, or http://localhost:3000
 *   npm run review:seed -- https://draftroom.online      against another server
 *
 * Talks to a running server, so it needs no database access: run it from a laptop against production.
 * Reads the two REVIEW_ACCOUNT_* variables from .env.local; never prints the code or a token.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const server = (process.argv[2] ?? read("REVIEW_SERVER_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const email = read("REVIEW_ACCOUNT_EMAIL");
const code = read("REVIEW_ACCOUNT_CODE");
if (!email || !code) fail("REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_CODE must be set (in .env.local).");

async function call(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}) {
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    fail(`Couldn't reach ${server}: ${error instanceof Error ? error.message : error}`);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, data };
}

const start = await call("POST", "/api/v1/auth/email/start", { body: { email } });
if (start.data?.step !== "code") fail(`${server} doesn't treat ${email} as the review account (${start.status}). Check REVIEW_ACCOUNT_EMAIL and REVIEW_ACCOUNT_CODE on the server.`);

const signIn = await call("POST", "/api/v1/auth/email/code", { body: { email, code } });
const token = typeof signIn.data?.token === "string" ? signIn.data.token : null;
if (!token) fail(`Sign-in failed (${signIn.status}): ${signIn.data?.error ?? "no token"}`);
console.log(`✓ Signed in as ${email} on ${server}`);

try {
  const setup = await call("POST", "/api/v1/review/setup", { token });
  if (setup.status !== 200) fail(`Couldn't connect the ESPN test leagues (${setup.status}): ${setup.data?.error ?? "unknown error"}`);
  const connected = (setup.data?.connected as string[]) ?? [];
  const kept = (setup.data?.kept as string[]) ?? [];
  console.log(`✓ ESPN test account read: ${connected.length} league(s) connected now, ${kept.length} already connected`);

  const me = await call("GET", "/api/v1/me", { token });
  const flags = (me.data?.flags ?? {}) as Record<string, boolean>;
  console.log(`  flags: season ${flags.season ? "on" : "OFF"}, ai ${flags.ai ? "on" : "OFF"}, review ${me.data?.review ? "on" : "OFF"}`);
  const leagues = await call("GET", "/api/v1/leagues", { token });
  for (const league of (leagues.data?.leagues as { id: string; name: string }[] | undefined) ?? []) console.log(`  · ${league.name}`);
  if (!flags.season) fail("In-season help is off for the reviewer: the app will show the closed-season screen.");
} finally {
  await call("POST", "/api/v1/auth/signout", { token, body: {} });
}
