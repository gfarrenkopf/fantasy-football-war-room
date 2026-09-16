/**
 * The ingestion CLI's single env reader.
 *
 * The app reads env through `src/lib/config.ts`, which imports `server-only` and so
 * can't be loaded by a plain node script. This is the CLI's equivalent: the one place
 * outside `config.ts` allowed to touch `process.env`, mirroring the same convention
 * (see the ESLint override in eslint.config.mjs).
 *
 * Run the CLI with `node --env-file-if-exists=.env.local` so `.env.local` is loaded,
 * exactly like `next dev` and `next start` do.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = Object.freeze({
  sportsDataApiKey: read("SPORTSDATA_API_KEY"),
});

export function requireApiKey(): string {
  if (!env.sportsDataApiKey) {
    throw new Error(
      "SPORTSDATA_API_KEY is not set. Put it in .env.local and run via `npm run ingest`, " +
        "which loads that file. See docs/data-pipeline.md.",
    );
  }
  return env.sportsDataApiKey;
}
