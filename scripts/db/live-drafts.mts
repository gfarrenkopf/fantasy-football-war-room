/**
 * Prints how many ESPN drafts War Room is holding right now (Epic 9): drafts where the server-side
 * client holds a user's ESPN connection. A restart drops those sockets, so deploy/deploy.sh asks
 * before it restarts the app.
 *
 *   npm run db:live-drafts        # prints a number
 *
 * Like db:migrate, it reads .env.local and DATABASE_URL directly.
 */
import pg from "pg";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  // The table arrives with migration 0006; before that, nothing can be live.
  const { rows } = await client.query<{ n: string }>(
    "select count(*) as n from espn_server_clients where state = 'holding' and expires_at > now()",
  );
  console.log(Number(rows[0].n));
} catch (error) {
  if (error instanceof Error && /relation .* does not exist/.test(error.message)) console.log(0);
  else {
    console.error("Couldn't count live drafts:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
