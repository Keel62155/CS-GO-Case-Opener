# Crate Rush Railway

Fake-money CS-style crate opening simulator with accounts, server-side rolls, leaderboards, inventory selling, earning, achievements, and player-to-player trades.

No deposits, no cashout, no paid currency, and no real-money item trading.

## Storage

This version does **not** use PostgreSQL or any database service. All user data is stored in one JSON file.

Default local file:

```txt
data/crate-rush-data.json
```

You can override it with:

```txt
DATA_FILE=/some/path/crate-rush-data.json
```

or:

```txt
DATA_DIR=/some/folder
```

If Railway provides `RAILWAY_VOLUME_MOUNT_PATH`, the app automatically uses that mounted folder unless `DATA_FILE` or `DATA_DIR` is set.

## Railway setup

1. Create a Railway project.
2. Deploy this project.
3. Create a Railway Volume and attach it to the web service.
4. Set the volume mount path to something like:

```txt
/app/data
```

5. Add an environment variable:

```txt
SESSION_SECRET=change-this-to-a-long-random-string
```

The data file will be created at:

```txt
/app/data/crate-rush-data.json
```

Do not mount the volume over `/app` or you can hide the app files.

## Local setup

```bash
npm install
SESSION_SECRET="dev-secret" npm run dev
```

Then open:

```txt
http://localhost:3000
```

## Audio

The frontend looks for:

```txt
public/csgo_ui_crate_item_scroll.wav
```

A provided `csgo_ui_crate_item_scroll.wav` is included in this project if you generated the zip from ChatGPT with the uploaded audio.

## Notes

File-based JSON storage is simple and fine for a small project. PostgreSQL is still better for a large public site with lots of concurrent users, but this version avoids needing a database service.


## Latest changes

- Added selected-case raised styling without the old clipping bug.
- Added stronger item reveal animations after case openings.
