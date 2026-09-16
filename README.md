# Fantasy War Room

An open-source fantasy football draft room. Keep a tiered board open during your draft, see which picks are **Value** or **Reach** against ADP, catch bye-week conflicts before they happen, and rehearse with a mock-draft simulator against CPU drafters that each have their own style.

> **Status: pre-alpha.** The free draft room works: tiered board, focus view with a computed turn plan, mock drafts, availability report, and bye-conflict detection. Hosted features aren't built yet. It grew out of a single-file prototype ([`prototype/war_room.html`](prototype/war_room.html)) used in a real 2026 draft.

## Free vs. hosted

- **Free forever, self-hostable:** the tiered board, mock-draft simulator, availability report, and bye-conflict detection.
- **Hosted (paid once per league, per season):** an account with league sync across devices, plus an AI-written draft plan tailored to your pick slot.

## Quick start

Requires Node.js 22+.

```sh
git clone https://github.com/gfarrenkopf/fantasy-football-war-room.git
cd fantasy-football-war-room
npm install
npm run build && npm start   # http://localhost:3000
```

No API keys or environment variables are needed. The app ships with clearly labeled sample player data.

**[Self-hosting guide →](docs/self-hosting.md)**: running on a server, league setup, using your own player data, and what the optional environment variables do.

**[Data pipeline →](docs/data-pipeline.md)**: optional. With a SportsDataIO key, refreshes ADP and projections into a dataset, with a QA gate that refuses to publish bad data and one-command rollback.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
