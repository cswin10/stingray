# Stingray — Ghost Race

A polished, genuinely playable sailing game. Steer the amber boat up a wind
beat and match a translucent cyan "ghost" that always sails the mathematically
optimum line. One live **Performance Score** rewards sailing the correct angle.

Built with Next.js (App Router), TypeScript, Tailwind CSS and vanilla Canvas
2D — no game engine, no backend, no database.

## Deploy to Vercel (recommended)

This repo is a stock Next.js app, so Vercel needs **no configuration** — it
auto-detects the framework, runs `next build`, and serves it.

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. **Import** the `cswin10/stingray` repository.
3. Leave every setting at its default (Framework: Next.js, Build Command:
   `next build`, Output: `.next`). No environment variables are needed.
4. Click **Deploy**. You'll get a live URL in ~1 minute.

### Which branch gets deployed

The game currently lives on the branch `claude/busy-goodall-hemq9c`. Vercel
deploys your **Production Branch** (defaults to `main`). Pick one:

- **Merge to `main`** (simplest long-term): open a PR from
  `claude/busy-goodall-hemq9c` into `main` and merge it. Vercel then deploys
  every push to `main`.
- **Deploy this branch as-is**: in Vercel → Project → **Settings → Git**, set
  the *Production Branch* to `claude/busy-goodall-hemq9c`. Vercel also builds a
  preview URL for every branch and PR automatically, so even without changing
  the production branch you'll get a shareable preview link for this branch.

After the first import, every `git push` triggers an automatic redeploy.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
```

## Other scripts

```bash
npm run build    # production build (type-checked)
npm run start    # serve the production build
npm run test     # polar maths unit tests (vitest)
```

## How to play

A 3·2·1·GO countdown starts each race. Hold **PORT / STBD** (or **A / D** /
arrow keys) to steer. Match the ghost's angle to push the Performance Score
toward 100% — point too high and you pinch, too low and you slip sideways. It
locks green **ON THE LINE** above 96.5%, and the trim hint points you back when
you drift off. Round the mark to get your grade, time and delta versus the
ghost; beat your average to set a new **BEST** (saved in your browser).

## Project structure

```
app/
  layout.tsx          fonts, metadata, dark background
  page.tsx            renders <GhostRace />
components/
  GhostRace.tsx       the game: canvas, HUD, controls, overlays, loop
lib/
  polar.ts            pure sailing maths (typed, no DOM)
  polar.test.ts       unit tests for the maths
```
