# Fantasy War Room

An open-source fantasy football draft room. Keep a tiered board open during your draft, see which picks are **Value** or **Reach** against ADP, catch bye-week conflicts before they happen, and rehearse with a mock-draft simulator against CPU drafters that each have their own style.

> **Status: pre-alpha.** Nothing works yet. The app is being built from a single-file prototype ([`prototype/war_room.html`](prototype/war_room.html)) that was used in a real 2026 draft.

## Free vs. hosted

- **Free forever, self-hostable:** the tiered board, mock-draft simulator, availability report, and bye-conflict detection.
- **Hosted (paid once per league, per season):** an account with league sync across devices, plus an AI-written draft plan tailored to your pick slot.

## Self-hosting

No configuration needed: `npm install && npm run build && npm start`. Hosted features switch on only when their env vars are set (see `.env.example`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
