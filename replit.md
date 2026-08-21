# World War Table

## Run on Replit

The app runs as a single Python web server:

```bash
python3 server.py
```

The Replit workflow starts it on port `5000`. The server serves the browser pages from the project root and exposes the game API under `/api`.

`SESSION_SECRET` must be configured before starting the server. The room state is stored in the local `.world_war_room.sqlite3` SQLite database, which is intentionally ignored by Git.

## Available pages

- `/` — commander entry and reconnect screen
- `/mobile.html` — mobile/controller view
- `/tv.html` — table/TV view
- `/rulebook.html` — game rules