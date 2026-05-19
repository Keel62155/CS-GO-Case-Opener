# Crate Rush Railway

Fake-money CS-style crate opening simulator with accounts, server-side rolls, leaderboards, inventory selling, earning, achievements, and player-to-player trades.

No deposits, no cashout, no paid currency, and no real-money item trading.

## Railway setup

1. Create a Railway project.
2. Add a PostgreSQL database to the project.
3. Deploy this repo/project.
4. Add an environment variable:

```txt
SESSION_SECRET=change-this-to-a-long-random-string
```

Railway's PostgreSQL service should provide `DATABASE_URL` automatically.

## Local setup

You need PostgreSQL locally and a `DATABASE_URL` environment variable.

```bash
npm install
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/craterush" SESSION_SECRET="dev-secret" npm run dev
```

Then open:

```txt
http://localhost:3000
```

## Audio

The frontend looks for:

```txt
public/Case.mp3
```

A provided `Case.mp3` is included in this project if you generated the zip from ChatGPT with the uploaded audio.
