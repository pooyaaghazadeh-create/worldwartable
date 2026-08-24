# World War Table

## Run on Replit

The app runs as a single Python web server:

```bash
python3 server.py
```

The Replit workflow starts it on port `5000`. The server serves the browser pages from the project root and exposes the game API under `/api`.

`SESSION_SECRET` must be configured before starting the server. Advanced Edition state is stored in the local `.world_war_room.sqlite3` SQLite database and Simple Edition state in `.world_war_room_simple.sqlite3`; both are intentionally ignored by Git.

## Available pages

- `/` — commander entry and reconnect screen
- `/mobile.html?edition=simple|advanced` — mobile/controller view for an edition
- `/tv.html?edition=simple|advanced` — table/TV view for an edition
- `/rulebook.html` — game rules