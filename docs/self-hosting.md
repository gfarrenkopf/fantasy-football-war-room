# Self-hosting Fantasy War Room

This guide covers running the free draft room on your own machine or server, swapping in your own player data, and what the optional hosted-feature settings do.

The free app runs entirely in the browser. It needs no database, no API keys, and no account. Draft state is saved in your browser's local storage.

## Contents

1. [Requirements](#1-requirements)
2. [Run it locally](#2-run-it-locally)
3. [Run it on a server](#3-run-it-on-a-server)
4. [Set up your league](#4-set-up-your-league)
5. [Use your own player data](#5-use-your-own-player-data)
6. [Environment variables and hosted features](#6-environment-variables-and-hosted-features)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Requirements

- **Node.js 22 or newer.** The repo pins Node 24 in `.nvmrc`. If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm install` then `nvm use` in the project folder. Check your version with `node -v`.
- **npm**, which comes with Node.
- **git**, to clone the repository.
- A modern browser (current Chrome, Edge, Firefox or Safari).

## 2. Run it locally

```sh
git clone https://github.com/gfarrenkopf/fantasy-football-war-room.git
cd fantasy-football-war-room
npm install
npm run dev
```

Open <http://localhost:3000>. The first time, the app asks you to set up your league (see [section 4](#4-set-up-your-league)). After that you're on the draft board.

`npm run dev` is the development server: it reloads when you edit code but is slower. For a draft, use the production build in the next section, even on your own laptop.

## 3. Run it on a server

Build once, then start the production server:

```sh
npm install
npm run build
npm start
```

- The server listens on port **3000** on all network interfaces, so other machines can reach it at `http://<server-ip>:3000` if your firewall allows it.
- Use another port with `PORT=8080 npm start`. Set `PORT` in the shell or service definition; it can't go in a `.env` file.
- Put a reverse proxy (Caddy, nginx) in front of it if you want HTTPS or a domain name.
- To keep it running after you log out, use a process manager such as `pm2` or a systemd service that runs `npm start` in the project folder.
- The hosted version's production setup (systemd, Caddy, Postgres and a deploy script) is documented in [deployment.md](deployment.md). It's more than the free app needs, but it's a working example.

**After changing code or player data, run `npm run build` again** and restart `npm start`. The production server only serves what was built.

Each browser keeps its own draft. If you open the app on a second device, it starts empty; syncing drafts across devices is a hosted feature.

## 4. Set up your league

On first run the **Set up your league** dialog opens. You can reopen it any time with the **League** button in the header.

You can keep several leagues, each with its own draft. Switch between them, or add one with **+ New league…**, from the league menu under the app name. **League** → **Delete league** removes the open league and its picks.

| Setting | What it does |
|---|---|
| Preset | Fills in a 10-, 12- or 14-team full-PPR league with a standard roster. The 14-team preset uses a 6-player bench so the sample data has enough players. |
| Teams | 4–20 teams. |
| Your draft slot | Your position in round 1. The draft is a snake: even rounds run in reverse. |
| Scoring | Only formats your player data has rankings for can be selected. The sample data is full PPR only. |
| Roster | How many QB, RB, WR, TE, FLEX (RB/WR/TE), SUPERFLEX (QB/RB/WR/TE), D/ST, K and bench slots each team has. Rounds = total slots. |
| Value/Reach threshold | How far apart ADP and expert rank must be (in spots) before a player gets a green **Value** or red **Reach Risk** tag. Default 10. |

If a setting can't work, the dialog says why and disables Save, e.g. when the draft needs more players than the data contains. Changing teams, slot, scoring or roster **after picks are logged** asks you to confirm, then clears the draft. Changing only the threshold keeps your picks.

## 5. Use your own player data

The app ships with `src/lib/data/sample-2026.json`, a **stale sample** built from late-August 2026 rankings. Replace it with your own file to use current rankings or another platform's ADP.

If you have a SportsDataIO key, the [data pipeline](data-pipeline.md) can generate this file for you instead of writing it by hand.

### Step by step

1. Create a JSON file in the format below, e.g. `my-rankings.json`.
2. Put it in `src/lib/data/`.
3. Open `src/lib/data/index.ts` and change the import line to your file:
   ```ts
   import sample from "./my-rankings.json";
   ```
   (Or overwrite `sample-2026.json` with your data and skip this step.)
4. Check it:
   ```sh
   npm run check-data
   ```
   This validates every field and checks bye weeks, position ranks, and that there are enough players for at least a 10-team league. A failure names the problem, e.g. `Invalid dataset: players[12].adp (Travis Kelce) must be a number`. `npm run build` runs the same check first and stops if it fails. (Use `check-data`, not `npm test`: the full test suite also checks facts about the bundled sample data and will fail on yours.)
5. Rebuild and restart: `npm run build && npm start`.
6. In the browser, open **League** and adjust the settings if your data supports different scoring. Saved drafts are keyed by player `id`, so keep ids stable between updates.

### File format

```json
{
  "season": 2026,
  "label": "My rankings, Sept 1",
  "adpSource": "Sleeper",
  "scoring": ["ppr"],
  "byeWeeks": { "BUF": 7, "DET": 6 },
  "players": [
    {
      "id": "jahmyr-gibbs-rb-det",
      "name": "Jahmyr Gibbs",
      "pos": "RB",
      "team": "DET",
      "bye": 6,
      "consensusRank": 1,
      "adp": 1,
      "posRank": 1,
      "note": "Optional injury or situation note",
      "projPoints": 312.5
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `season` | yes | Season year (number). |
| `label` | yes | Shown in the league dialog so you know which data is loaded. |
| `adpSource` | yes | Name of the platform your ADP comes from. Cards label the ADP column with it (e.g. "Sleeper 12"). |
| `scoring` | yes | Formats these rankings are valid for: any of `"ppr"`, `"half"`, `"std"`. |
| `byeWeeks` | yes | Bye week for every NFL team abbreviation used in `players`. |
| `players[].id` | yes | Unique, stable string. Suggested: `name-pos-team`, lowercase with dashes. Saved drafts refer to players by id. |
| `players[].name` | yes | Display name. |
| `players[].pos` | yes | One of `QB`, `RB`, `WR`, `TE`, `K`, `DST`. |
| `players[].team` | yes | NFL team abbreviation, matching a key in `byeWeeks`. |
| `players[].bye` | yes | Bye week (number). |
| `players[].consensusRank` | yes | Overall rank by merit, 1 = best — expert consensus rank (ECR) is the usual source. Drives tiers, sorting and the "sharp" CPU drafters. It must come from something **other than** your ADP: the two are compared to produce Value/Reach tags, so if both columns hold the same ranking, every player is tagged "even". Projected points are a fine alternative source; see [the data pipeline](data-pipeline.md#6-how-consensusrank-is-derived) for the pitfalls. |
| `players[].adp` | yes | Overall average draft position on your platform. Drives the "casual" CPU drafters and Value/Reach tags. Keep it on the same scale as `consensusRank` — both should be positions within *this* file's player list. Pasting in raw ADP measured across a much larger player pool makes almost everyone look like a Value. |
| `players[].posRank` | yes | Rank within the position by `consensusRank`, 1 = best. |
| `players[].note` | no | Short note; cards show a yellow dot with the note on hover. |
| `players[].projPoints` | no | Season projected points. If every tiered player has it, tiers are built from points instead of ranks. |

### How much data you need

The simulator needs more players than the draft has picks, or the last picks run out of legal choices. Include at least **teams × rounds + 10** players, with at least one K and one D/ST per team. A 12-team, 16-round league needs 202 or more. The sample has 225, which is why the 14-team preset uses 15 rounds.

## 6. Environment variables and hosted features

**None are needed to self-host.** With no environment variables, every hosted feature is off and the free draft room works fully.

The variables exist for the paid hosted version. Accounts and cross-device sync are built (see [database.md](database.md) for the Postgres setup). AI plans and payments aren't yet. They're read in one place, `src/lib/config.ts`, and documented in `.env.example`. To set them, copy `.env.example` to `.env.local` and fill in values (both `npm run dev` and `npm start` read it), or export them in the environment that runs the server.

| Variable | Turns on | Also requires | Status |
|---|---|---|---|
| `DATABASE_URL` | Accounts and cross-device league sync | `NEXTAUTH_SECRET`, and at least one sign-in method | Available |
| `NEXTAUTH_SECRET` | Signing auth sessions. Generate with `openssl rand -base64 32`. | `DATABASE_URL` | Available |
| `NEXTAUTH_URL` | The site's public URL, e.g. `https://warroom.example.com`. **Required in production**, where sign-in otherwise rejects requests. | cloud features | Available |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Sign in with Google. Set the OAuth redirect URI to `<NEXTAUTH_URL>/api/auth/callback/google`. | cloud features | Available |
| `AUTH_RESEND_KEY`, `EMAIL_FROM` | Sign in with an emailed magic link, sent through [Resend](https://resend.com). `EMAIL_FROM` must be on a domain verified in Resend. | cloud features | Available |
| `ANTHROPIC_API_KEY` | AI-written draft plan | cloud features (database + auth secret) | Planned |
| `STRIPE_SECRET_KEY` | Payments | cloud features | Planned |
| `SPORTSDATA_API_KEY` | The [data pipeline](data-pipeline.md), for refreshing player data from SportsDataIO | nothing | Available |

If a key is set without what it depends on (say, a Stripe key without a database), the feature stays off and the server logs a `[config]` warning explaining why.

Set variables are read when the server **starts**, not at build time, so you can change them and restart without rebuilding.

## 7. Troubleshooting

**`npm install` fails with engine or syntax errors.** Your Node version is too old. Run `node -v`; you need 22 or newer.

**Port 3000 is already in use.** Run `PORT=3001 npm start` (or `npm run dev -- -p 3001`).

**`npm run build` stops with `Invalid dataset: …`.** Your player file doesn't match the format. The message names the first bad field, for example `players[12].adp (Travis Kelce) must be a number`. Fix the file and build again; `npm run check-data` runs just this check.

**League setup says the player data only supports N picks.** Your data has too few players for that league. Reduce teams or bench slots, or add players (see [How much data you need](#how-much-data-you-need)).

**My draft disappeared.** Drafts live in that browser's local storage. Private/incognito windows, clearing site data, or a different browser or device all start fresh.

**I changed the data or code but the app looks the same.** Run `npm run build` again and restart `npm start`.

**I want to start over completely.** Use **Reset draft** for the picks. To also forget league settings and preferences, clear this site's data in your browser settings.
