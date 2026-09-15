# Contributing

Thanks for your interest! The project is pre-alpha, so this guide is short for now and will grow.

## Workflow

- Work on a branch. Name it after the tracking issue if there is one (e.g. `greg/ape-61-02-scaffold-nextjs-app`), or use a short descriptive name.
- Open a pull request against `main`. CI must pass before it can merge.
- Keep each PR to one change.

## Local setup

Requires Node.js 22+ (`.nvmrc` pins 24).

```sh
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm run build
```

## Styling

- The app uses **Tailwind CSS v4**. Design tokens (colors, radius, font) are defined in the `@theme` block of `src/app/globals.css` and were ported from the prototype's `:root` variables.
- Use the token utilities (`bg-panel`, `text-muted`, `border-qb`, `text-value`, ...). Don't hard-code hex values in components. If you need a new color, add a token first.
- The app is dark-only.

## More to come

Local setup, code style, and project conventions will be documented here as the app takes shape.
